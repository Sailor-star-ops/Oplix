// Import du catalogue manga dans Supabase, en deux phases (même schéma que
// sync-anime.mjs) :
//  1) squelette (titre, auteur, éditeur, date) depuis Wikidata (CC0), sans
//     MangaDex — seuls les manga notables présents sur Wikidata sont importés
//  2) enrichissement (couverture, synopsis, genres, statut, volumes/chapitres)
//     depuis l'API MAL v2, par mal_id — comble le plus gros manque de la
//     phase 1 (aucune image, aucun résumé) pour ~96% des lignes (mal_id présent)
//
// Propriétés Wikidata utilisées (vérifiées manuellement, pas de mémoire) :
//   P4087 = MyAnimeList manga ID     P8731 = AniList manga ID
//   P50   = auteur                   P123  = éditeur
//   P577  = date de publication
//
// Usage : node scripts/sync-manga-wikidata.mjs
// Nécessite .env (voir .env.example) — sans MAL_CLIENT_ID, la phase 2 est
// sautée et seul le squelette (phase 1) est importé.
// SYNC_LIMIT=20 node scripts/sync-manga-wikidata.mjs -> pour tester rapidement
// la phase 2 avant de lancer l'enrichissement complet (~8000 titres, ~2h20 à ~1 req/s).

import { supabaseAdmin, sleep, upsertInChunks } from "./lib/supabaseAdmin.mjs";

const MAL_CLIENT_ID = process.env.MAL_CLIENT_ID;
const MAL_RATE_LIMIT_MS = 1100; // ~1 req/s, même convention que sync-anime.mjs
const SYNC_LIMIT = process.env.SYNC_LIMIT ? parseInt(process.env.SYNC_LIMIT, 10) : null;

// MAL utilise un statut différent de l'enum interne (voir STATUS_LABELS dans
// src/lib/catalog.js) — même esprit de mapping que STATUS_MAP dans sync-anime.mjs.
const MANGA_STATUS_MAP = {
  finished: "FINISHED",
  currently_publishing: "RELEASING",
  not_yet_published: "NOT_YET_RELEASED",
  discontinued: "CANCELLED",
  on_hiatus: "HIATUS",
};

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";

// Pas de GROUP_CONCAT ici (fragile à combiner avec le service de labels) —
// on récupère des lignes à plat (produit croisé possible si auteur ET
// éditeur sont multi-valués) et on regroupe côté JS par item.
const QUERY = `
SELECT ?item ?itemLabel ?malId ?anilistId ?authorLabel ?publisherLabel ?startDate WHERE {
  { ?item wdt:P4087 ?malId. } UNION { ?item wdt:P8731 ?anilistId. }
  OPTIONAL { ?item wdt:P4087 ?malId. }
  OPTIONAL { ?item wdt:P8731 ?anilistId. }
  OPTIONAL { ?item wdt:P50 ?author. }
  OPTIONAL { ?item wdt:P123 ?publisher. }
  OPTIONAL { ?item wdt:P577 ?startDate. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
}
LIMIT 50000
`;

// Plage réservée pour les manga sans croisement AniList sur Wikidata,
// au-dessus de tout ID AniList réel — dérivé du numéro du QID pour rester
// stable entre deux exécutions (idempotent).
const INTERNAL_ID_OFFSET = 900_000_000;

function qidToInternalId(itemUri) {
  const m = itemUri.match(/Q(\d+)$/);
  return m ? INTERNAL_ID_OFFSET + parseInt(m[1], 10) : null;
}

async function runQuery() {
  const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(QUERY)}&format=json`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/sparql-results+json",
      "User-Agent": "Oplix-catalog-sync/1.0 (script d'import interne, usage non commercial des données Wikidata)",
    },
  });
  if (!res.ok) throw new Error(`Échec requête SPARQL Wikidata : HTTP ${res.status}`);
  const json = await res.json();
  return json.results.bindings;
}

function groupByItem(bindings) {
  const byItem = new Map();
  for (const b of bindings) {
    const itemUri = b.item.value;
    if (!byItem.has(itemUri)) {
      byItem.set(itemUri, {
        itemUri,
        title: b.itemLabel?.value || null,
        malId: b.malId ? parseInt(b.malId.value, 10) : null,
        anilistId: b.anilistId ? parseInt(b.anilistId.value, 10) : null,
        authors: new Set(),
        publisher: null,
        startDate: null,
      });
    }
    const entry = byItem.get(itemUri);
    if (b.authorLabel?.value) entry.authors.add(b.authorLabel.value);
    if (b.publisherLabel?.value && !entry.publisher) entry.publisher = b.publisherLabel.value;
    if (b.startDate?.value && !entry.startDate) entry.startDate = b.startDate.value.slice(0, 10);
    if (!entry.malId && b.malId) entry.malId = parseInt(b.malId.value, 10);
    if (!entry.anilistId && b.anilistId) entry.anilistId = parseInt(b.anilistId.value, 10);
  }
  return [...byItem.values()];
}

function toRow(entry) {
  const id = entry.anilistId || qidToInternalId(entry.itemUri);
  if (!id || !entry.title) return null;
  return {
    id,
    mal_id: entry.malId || null,
    title_romaji: entry.title,
    authors: [...entry.authors],
    publisher: entry.publisher,
    start_date: entry.startDate,
    last_synced_at: new Date().toISOString(),
  };
}

async function fetchMalMangaFields(malId, attempt = 1) {
  const fields = "synopsis,genres,main_picture,status,num_volumes,num_chapters,nsfw";
  let res;
  try {
    res = await fetch(`https://api.myanimelist.net/v2/manga/${malId}?fields=${fields}`, {
      headers: { "X-MAL-CLIENT-ID": MAL_CLIENT_ID },
    });
  } catch (networkErr) {
    if (attempt < 2) {
      await sleep(3000);
      return fetchMalMangaFields(malId, attempt + 1);
    }
    throw networkErr;
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      "MAL a refusé la requête (401/403) — vérifie MAL_CLIENT_ID dans .env et que l'appli est bien enregistrée sur myanimelist.net/apiconfig/create.",
    );
  }
  if (res.status === 404) return null; // manga retiré/introuvable côté MAL, pas fatal
  if (!res.ok) {
    if (attempt < 2 && res.status >= 500) {
      await sleep(3000);
      return fetchMalMangaFields(malId, attempt + 1);
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
  let withMal = rows.filter((r) => r.mal_id);
  if (SYNC_LIMIT) {
    withMal = withMal.slice(0, SYNC_LIMIT);
    console.log(`SYNC_LIMIT actif : réduit à ${withMal.length} entrées pour ce run de test.`);
  }
  console.log(`Phase 2 (enrichissement MAL) : ${withMal.length} entrées à enrichir, ~1 req/s...`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of withMal) {
    try {
      const data = await fetchMalMangaFields(row.mal_id);
      if (!data) {
        skipped++;
      } else {
        const update = {
          id: row.id,
          synopsis: data.synopsis || null,
          genres: (data.genres || []).map((g) => g.name),
          cover_url: data.main_picture?.large || data.main_picture?.medium || null,
          status: MANGA_STATUS_MAP[data.status] || null,
          volumes: data.num_volumes || null,
          chapters: data.num_chapters || null,
        };
        const { error } = await supabaseAdmin.from("catalog_manga").update(update).eq("id", row.id);
        if (error) throw new Error(error.message);
        ok++;
      }
    } catch (err) {
      failed++;
      console.error(`MAL manga#${row.mal_id} (id#${row.id}) : ${err.message}`);
      if (err.message.includes("MAL a refusé")) break; // inutile de continuer si le Client ID est mauvais
    }
    await sleep(MAL_RATE_LIMIT_MS);
  }
  console.log(`Phase 2 terminée : ${ok} enrichis, ${skipped} introuvables côté MAL, ${failed} échecs.`);
}

// Pagine sur les lignes déjà en base (utilisé si la Phase 1 échoue, pour ne
// pas bloquer la Phase 2 sur un souci Wikidata sans rapport avec MAL).
async function fetchExistingMangaRows() {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from("catalog_manga")
      .select("id, mal_id")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  let rows;
  try {
    console.log("Requête SPARQL Wikidata (manga avec ID MAL et/ou AniList)...");
    const bindings = await runQuery();
    console.log(`${bindings.length} lignes brutes reçues.`);

    const grouped = groupByItem(bindings);
    const rawRows = grouped.map(toRow).filter(Boolean);
    // Deux items Wikidata distincts (ex: l'œuvre et la série) peuvent partager le
    // même ID AniList/MAL — Postgres refuse un ON CONFLICT en double dans le même
    // batch, donc on déduplique par id avant d'upserter (on garde la 1ère occurrence).
    const byId = new Map();
    for (const row of rawRows) if (!byId.has(row.id)) byId.set(row.id, row);
    rows = [...byId.values()];
    console.log(`${rows.length} manga exploitables (titre + ID présents) sur ${grouped.length} items Wikidata (${rawRows.length - rows.length} doublons d'ID fusionnés).`);

    const withAnilistId = rows.filter((r) => r.id < 900_000_000).length;
    console.log(`  dont ${withAnilistId} avec un croisement AniList, ${rows.length - withAnilistId} en ID interne Oplix.`);

    const done = await upsertInChunks("catalog_manga", rows);
    console.log(`Phase 1 (squelette) : ${done}/${rows.length} lignes upsertées dans catalog_manga.`);
  } catch (err) {
    console.error(`Phase 1 (Wikidata) en échec, sautée : ${err.message}`);
    console.log("Reprise sur les lignes déjà en base pour ne pas bloquer la Phase 2 (MAL)...");
    rows = await fetchExistingMangaRows();
    console.log(`${rows.length} lignes existantes récupérées depuis catalog_manga.`);
  }

  await enrichFromMal(rows);
  console.log("Import manga terminé.");
}

main().catch((err) => {
  console.error("Échec de l'import manga :", err);
  process.exit(1);
});
