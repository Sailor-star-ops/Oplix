// Import du catalogue anime dans Supabase, en deux phases :
//  1) squelette factuel depuis anime-offline-database (licence ODbL,
//     https://github.com/manami-project/anime-offline-database)
//  2) enrichissement (synopsis, genres, rating, source, broadcast,
//     dates précises, relations typées) depuis l'API MAL v2, par mal_id
//
// Usage : node scripts/sync-anime.mjs
// Nécessite .env (voir .env.example) — sans MAL_CLIENT_ID, la phase 2
// est sautée et seul le squelette (phase 1) est importé.

import { supabaseAdmin, sleep, upsertInChunks } from "./lib/supabaseAdmin.mjs";

// URL stable : redirige toujours vers l'asset de la dernière release
// (le tag de version change à chaque publication, ex. "2026-27").
const DATASET_URL =
  "https://github.com/manami-project/anime-offline-database/releases/latest/download/anime-offline-database-minified.json";

const MAL_CLIENT_ID = process.env.MAL_CLIENT_ID;
const MAL_RATE_LIMIT_MS = 1100; // ~1 req/s, convention communautaire non-officielle
// SYNC_LIMIT=20 node scripts/sync-anime.mjs -> pour tester rapidement le pipeline
// avant de lancer l'import complet (qui prend plusieurs heures à ~1 req/s vers MAL).
const SYNC_LIMIT = process.env.SYNC_LIMIT ? parseInt(process.env.SYNC_LIMIT, 10) : null;

// anime-offline-database utilise un statut différent de l'enum AniList
// (à vérifier/ajuster si le premier run signale des valeurs inconnues).
const STATUS_MAP = {
  FINISHED: "FINISHED",
  ONGOING: "RELEASING",
  UPCOMING: "NOT_YET_RELEASED",
  UNKNOWN: null,
};

function extractSourceIds(sources = []) {
  const ids = { anilist_id: null, mal_id: null, anidb_id: null, kitsu_id: null };
  for (const url of sources) {
    let m;
    if ((m = url.match(/anilist\.co\/anime\/(\d+)/))) ids.anilist_id = parseInt(m[1], 10);
    else if ((m = url.match(/myanimelist\.net\/anime\/(\d+)/))) ids.mal_id = parseInt(m[1], 10);
    else if ((m = url.match(/anidb\.net\/anime\/(\d+)/))) ids.anidb_id = parseInt(m[1], 10);
    else if ((m = url.match(/kitsu\.(?:io|app)\/anime\/(\d+)/))) ids.kitsu_id = parseInt(m[1], 10);
  }
  return ids;
}

function extractRelatedAnilistIds(relatedAnime = []) {
  const out = [];
  for (const url of relatedAnime) {
    const m = url.match(/anilist\.co\/anime\/(\d+)/);
    if (m) out.push({ id: parseInt(m[1], 10), relation_type: null });
  }
  return out;
}

function toRow(entry) {
  const { anilist_id, mal_id, anidb_id, kitsu_id } = extractSourceIds(entry.sources);
  if (!anilist_id) return null; // pas d'ID AniList = pas de clé primaire réutilisable, on saute

  const durationSec = entry.duration?.unit === "SECONDS" ? entry.duration.value : null;
  const status = STATUS_MAP[entry.status] ?? entry.status ?? null;
  if (!(entry.status in STATUS_MAP)) {
    console.warn(`Statut dataset inconnu (non mappé) : "${entry.status}" sur AniList#${anilist_id}`);
  }

  return {
    id: anilist_id,
    mal_id,
    anidb_id,
    kitsu_id,
    title_romaji: entry.title || null,
    title_english: null, // le dataset n'a qu'un seul titre + synonymes non structurés par langue
    title_native: null,
    synonyms: entry.synonyms || [],
    type: entry.type || null,
    status,
    episodes: entry.episodes || null,
    duration_minutes: durationSec ? Math.round(durationSec / 60) : null,
    season: entry.animeSeason?.season && entry.animeSeason.season !== "UNDEFINED" ? entry.animeSeason.season : null,
    season_year: entry.animeSeason?.year || null,
    studios: entry.studios || [],
    producers: entry.producers || [],
    tags: entry.tags || [],
    cover_url: entry.picture || null,
    thumbnail_url: entry.thumbnail || null,
    score: entry.score?.arithmeticMean ?? null,
    relations: extractRelatedAnilistIds(entry.relatedAnime),
    last_synced_at: new Date().toISOString(),
  };
}

async function importDataset() {
  console.log("Téléchargement de anime-offline-database...");
  const res = await fetch(DATASET_URL);
  if (!res.ok) throw new Error(`Échec téléchargement dataset : HTTP ${res.status}`);
  const json = await res.json();
  const entries = json.data || [];
  console.log(`${entries.length} entrées dans le dataset.`);

  let rows = entries.map(toRow).filter(Boolean);
  console.log(`${rows.length} entrées avec un ID AniList exploitable (${entries.length - rows.length} sautées).`);
  if (SYNC_LIMIT) {
    rows = rows.slice(0, SYNC_LIMIT);
    console.log(`SYNC_LIMIT actif : réduit à ${rows.length} entrées pour ce run de test.`);
  }

  const done = await upsertInChunks("catalog_anime", rows);
  console.log(`Phase 1 (squelette) : ${done}/${rows.length} lignes upsertées dans catalog_anime.`);
  return rows;
}

// MAL renvoie parfois une date partielle ("2016-05" ou "2011") quand le jour
// ou le mois exact est inconnu — Postgres (colonne `date`) refuse ce format,
// donc on complète au 1er du mois/de l'année plutôt que de planter.
function normalizeDate(d) {
  if (!d) return null;
  const parts = d.split("-");
  while (parts.length < 3) parts.push("01");
  return parts.join("-");
}

async function fetchMalFields(malId, attempt = 1) {
  const fields =
    "synopsis,genres,rating,source,broadcast,start_date,end_date,related_anime,nsfw,mean,popularity,rank,num_list_users";
  let res;
  try {
    res = await fetch(`https://api.myanimelist.net/v2/anime/${malId}?fields=${fields}`, {
      headers: { "X-MAL-CLIENT-ID": MAL_CLIENT_ID },
    });
  } catch (networkErr) {
    if (attempt < 2) {
      await sleep(3000);
      return fetchMalFields(malId, attempt + 1);
    }
    throw networkErr;
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      "MAL a refusé la requête (401/403) — vérifie MAL_CLIENT_ID dans .env et que l'appli est bien enregistrée sur myanimelist.net/apiconfig/create.",
    );
  }
  if (!res.ok) {
    if (attempt < 2 && res.status >= 500) {
      await sleep(3000);
      return fetchMalFields(malId, attempt + 1);
    }
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

async function enrichFromMal(rows) {
  if (!MAL_CLIENT_ID) {
    console.warn("MAL_CLIENT_ID absent de .env — phase 2 (enrichissement MAL) sautée.");
    return;
  }
  const withMal = rows.filter((r) => r.mal_id);
  console.log(`Phase 2 (enrichissement MAL) : ${withMal.length} entrées à enrichir, ~1 req/s...`);

  let ok = 0;
  let failed = 0;
  for (const row of withMal) {
    try {
      const data = await fetchMalFields(row.mal_id);
      const update = {
        id: row.id,
        synopsis: data.synopsis || null,
        genres: (data.genres || []).map((g) => g.name),
        age_rating: data.rating || null,
        nsfw_level: data.nsfw || null,
        source_type: data.source ? data.source.toUpperCase() : null,
        start_date: normalizeDate(data.start_date),
        end_date: normalizeDate(data.end_date),
        broadcast_day: data.broadcast?.day_of_the_week || null,
        broadcast_time: data.broadcast?.start_time || null,
        score: data.mean ?? row.score ?? null,
        popularity: data.popularity ?? data.num_list_users ?? null,
        relations: (data.related_anime || [])
          .map((r) => ({ id: r.node?.id, relation_type: r.relation_type }))
          .filter((r) => r.id),
      };
      const { error } = await supabaseAdmin.from("catalog_anime").update(update).eq("id", row.id);
      if (error) throw new Error(error.message);
      ok++;
    } catch (err) {
      failed++;
      console.error(`MAL#${row.mal_id} (AniList#${row.id}) : ${err.message}`);
      if (err.message.includes("MAL a refusé")) break; // inutile de continuer si le Client ID est mauvais
    }
    await sleep(MAL_RATE_LIMIT_MS);
  }
  console.log(`Phase 2 terminée : ${ok} enrichies, ${failed} échecs.`);
}

async function main() {
  const rows = await importDataset();
  await enrichFromMal(rows);
  console.log("Import anime terminé.");
}

main().catch((err) => {
  console.error("Échec de l'import :", err);
  process.exit(1);
});
