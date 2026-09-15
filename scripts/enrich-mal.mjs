// Enrichissement MyAnimeList, reprenable et priorisé.
//
// Pourquoi un script à part : la phase 2 de sync-anime.mjs repartait de zéro à
// chaque exécution et traitait le catalogue dans l'ordre du dataset. Avec
// ~30 500 anime à 1 requête/seconde, soit près de 9 heures, aucune session ne
// tenait jusqu'au bout — et chaque interruption perdait tout.
//
// Ce script corrige les deux causes :
//   - REPRENABLE : seules les fiches dont `mal_synced_at` est vide sont
//     traitées. Arrête quand tu veux (Ctrl+C), relance plus tard, ça continue.
//   - PRIORISÉ : les fiches les mieux classées d'abord. Les 500 premières
//     minutes couvrent les œuvres que les utilisateurs cherchent réellement,
//     au lieu de commencer par des OVA obscures.
//
// Apporte aussi au manga les statistiques qu'il n'a jamais eues : l'API manga
// de MyAnimeList expose mean / popularity / num_list_users / rank exactement
// comme l'API anime — ils n'étaient simplement jamais demandés.
//
// Usage :
//   node scripts/enrich-mal.mjs                 # anime puis manga, jusqu'au bout
//   node scripts/enrich-mal.mjs --limit 1000    # s'arrête après 1000 fiches
//   node scripts/enrich-mal.mjs --manga         # manga seulement
//   node scripts/enrich-mal.mjs --minutes 30    # s'arrête au bout de 30 minutes

import { supabaseAdmin, sleep } from "./lib/supabaseAdmin.mjs";

const MAL_CLIENT_ID = process.env.MAL_CLIENT_ID;
const RATE_LIMIT_MS = 1100; // ~1 req/s, convention communautaire

const args = process.argv.slice(2);
const doAnime = args.length === 0 || args.includes("--anime") || !args.includes("--manga");
const doManga = args.length === 0 || args.includes("--manga") || !args.includes("--anime");

function numArg(flag, fallback) {
  const i = args.indexOf(flag);
  if (i === -1 || !args[i + 1]) return fallback;
  const n = parseInt(args[i + 1], 10);
  return Number.isFinite(n) ? n : fallback;
}
const LIMIT = numArg("--limit", Infinity);
const MINUTES = numArg("--minutes", Infinity);
const deadline = Number.isFinite(MINUTES) ? Date.now() + MINUTES * 60_000 : Infinity;

const ANIME_FIELDS = [
  "synopsis", "genres", "rating", "source", "broadcast", "start_date", "end_date",
  "related_anime", "nsfw", "mean", "popularity", "rank", "num_list_users",
  "alternative_titles",
].join(",");

const MANGA_FIELDS = [
  "synopsis", "genres", "main_picture", "status", "num_volumes", "num_chapters",
  "nsfw", "mean", "popularity", "rank", "num_list_users", "alternative_titles",
  "start_date", "end_date", "authors{first_name,last_name}",
].join(",");

const MANGA_STATUS_MAP = {
  finished: "FINISHED",
  currently_publishing: "RELEASING",
  not_yet_published: "NOT_YET_RELEASED",
  discontinued: "CANCELLED",
  on_hiatus: "HIATUS",
};

/* ─── Réseau ────────────────────────────────────────────────────────── */

async function malFetch(kind, malId, fields, attempt = 1) {
  let res;
  try {
    res = await fetch(`https://api.myanimelist.net/v2/${kind}/${malId}?fields=${fields}`, {
      headers: { "X-MAL-CLIENT-ID": MAL_CLIENT_ID },
    });
  } catch (err) {
    if (attempt < 3) {
      await sleep(3000 * attempt);
      return malFetch(kind, malId, fields, attempt + 1);
    }
    throw err;
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error("FATAL: MAL a refusé la requête (401/403) — vérifie MAL_CLIENT_ID dans .env.");
  }
  if (res.status === 404) return null; // œuvre retirée côté MAL, pas bloquant
  if (res.status === 429) {
    await sleep(30_000);
    return malFetch(kind, malId, fields, attempt);
  }
  if (!res.ok) {
    if (attempt < 3 && res.status >= 500) {
      await sleep(3000 * attempt);
      return malFetch(kind, malId, fields, attempt + 1);
    }
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

/* ─── Utilitaires ───────────────────────────────────────────────────── */

// MAL renvoie parfois une date partielle ("2016-05") : Postgres refuse.
function normalizeDate(d) {
  if (!d) return null;
  const parts = d.split("-");
  while (parts.length < 3) parts.push("01");
  return parts.join("-");
}

const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && v.length === 0);
// MyAnimeList prime sur les autres sources pour les statistiques, mais ne doit
// pas écraser le texte déjà apporté par Anime News Network.
const keep = (current, incoming) => (isEmpty(current) ? (isEmpty(incoming) ? null : incoming) : current);

// Un rang 0 ne veut pas dire "premier" mais "non classé" : le laisser tel quel
// placerait ces fiches en tête de tous les classements croissants.
const rankOrNull = (n) => (Number.isFinite(n) && n > 0 ? n : null);

async function pendingRows(table, cols) {
  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(cols)
      .not("mal_id", "is", null)
      .is("mal_synced_at", null)
      // Les mieux classés d'abord : le temps passé profite aux œuvres consultées.
      .order("popularity", { ascending: true, nullsFirst: false })
      // Départage sur l'id : le rang a des ex æquo et des null, et un tri non
      // unique fait sauter ou répéter des lignes d'une page à l'autre.
      .order("id", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(`${table} : ${error.message}`);
    rows.push(...data);
    if (data.length < page || rows.length >= LIMIT) break;
  }
  return rows.slice(0, LIMIT);
}

/* ─── Anime ─────────────────────────────────────────────────────────── */

async function enrichAnime() {
  const rows = await pendingRows(
    "catalog_anime",
    "id, mal_id, synopsis, genres, start_date, end_date, title_english, title_native, synonyms, score",
  );
  const { count: total } = await supabaseAdmin
    .from("catalog_anime")
    .select("id", { count: "exact", head: true })
    .not("mal_id", "is", null);
  console.log(`\n═══ Anime ═══\n${rows.length} fiches restantes sur ${total} à enrichir.`);
  if (!rows.length) return 0;

  // Correspondance ID MyAnimeList -> ID catalogue, pour que les œuvres liées
  // pointent vers des lignes réellement présentes en base.
  const { data: idMap } = await supabaseAdmin.from("catalog_anime").select("id, mal_id").not("mal_id", "is", null);
  const malToId = new Map((idMap || []).map((r) => [r.mal_id, r.id]));

  let ok = 0;
  let gone = 0;
  for (const [i, row] of rows.entries()) {
    if (Date.now() > deadline) {
      console.log("\nDurée impartie atteinte — arrêt propre.");
      break;
    }
    try {
      const d = await malFetch("anime", row.mal_id, ANIME_FIELDS);
      if (!d) {
        gone++;
        await supabaseAdmin.from("catalog_anime").update({ mal_synced_at: new Date().toISOString() }).eq("id", row.id);
      } else {
        const alt = d.alternative_titles || {};
        await supabaseAdmin
          .from("catalog_anime")
          .update({
            synopsis: keep(row.synopsis, d.synopsis),
            genres: isEmpty(row.genres) ? (d.genres || []).map((g) => g.name) : row.genres,
            age_rating: d.rating || null,
            nsfw_level: d.nsfw || null,
            source_type: d.source ? d.source.toUpperCase() : null,
            start_date: keep(row.start_date, normalizeDate(d.start_date)),
            end_date: keep(row.end_date, normalizeDate(d.end_date)),
            broadcast_day: d.broadcast?.day_of_the_week || null,
            broadcast_time: d.broadcast?.start_time || null,
            score: d.mean ?? row.score ?? null,
            popularity: rankOrNull(d.popularity),
            members: d.num_list_users ?? null,
            rank_overall: rankOrNull(d.rank),
            title_english: keep(row.title_english, alt.en),
            title_native: keep(row.title_native, alt.ja),
            synonyms: [...new Set([...(row.synonyms || []), ...(alt.synonyms || [])])],
            relations: (d.related_anime || [])
              .map((r) => ({ id: malToId.get(r.node?.id) ?? null, relation_type: r.relation_type }))
              .filter((r) => r.id),
            mal_synced_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        ok++;
      }
    } catch (err) {
      if (err.message.startsWith("FATAL")) throw err;
      console.error(`\n  MAL anime#${row.mal_id} : ${err.message}`);
    }
    if ((i + 1) % 10 === 0 || i === rows.length - 1) {
      process.stdout.write(`\r  ${i + 1}/${rows.length} — ${ok} enrichies, ${gone} disparues de MAL   `);
    }
    await sleep(RATE_LIMIT_MS);
  }
  console.log("");
  return ok;
}

/* ─── Manga ─────────────────────────────────────────────────────────── */

async function enrichManga() {
  const rows = await pendingRows(
    "catalog_manga",
    "id, mal_id, synopsis, genres, cover_url, status, volumes, chapters, start_date, title_english, title_native, authors",
  );
  const { count: total } = await supabaseAdmin
    .from("catalog_manga")
    .select("id", { count: "exact", head: true })
    .not("mal_id", "is", null);
  console.log(`\n═══ Manga ═══\n${rows.length} fiches restantes sur ${total} à enrichir.`);
  if (!rows.length) return 0;

  let ok = 0;
  let gone = 0;
  for (const [i, row] of rows.entries()) {
    if (Date.now() > deadline) {
      console.log("\nDurée impartie atteinte — arrêt propre.");
      break;
    }
    try {
      const d = await malFetch("manga", row.mal_id, MANGA_FIELDS);
      if (!d) {
        gone++;
        await supabaseAdmin.from("catalog_manga").update({ mal_synced_at: new Date().toISOString() }).eq("id", row.id);
      } else {
        const alt = d.alternative_titles || {};
        const authors = (d.authors || [])
          .map((a) => [a.node?.first_name, a.node?.last_name].filter(Boolean).join(" ").trim())
          .filter(Boolean);
        await supabaseAdmin
          .from("catalog_manga")
          .update({
            synopsis: keep(row.synopsis, d.synopsis),
            genres: isEmpty(row.genres) ? (d.genres || []).map((g) => g.name) : row.genres,
            cover_url: keep(row.cover_url, d.main_picture?.large || d.main_picture?.medium),
            status: keep(row.status, MANGA_STATUS_MAP[d.status]),
            volumes: keep(row.volumes, d.num_volumes),
            chapters: keep(row.chapters, d.num_chapters),
            start_date: keep(row.start_date, normalizeDate(d.start_date)),
            title_english: keep(row.title_english, alt.en),
            title_native: keep(row.title_native, alt.ja),
            authors: isEmpty(row.authors) ? authors : row.authors,
            // Les statistiques que le manga n'avait jamais eues.
            score: d.mean ?? null,
            popularity: rankOrNull(d.popularity),
            members: d.num_list_users ?? null,
            rank_overall: rankOrNull(d.rank),
            mal_synced_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        ok++;
      }
    } catch (err) {
      if (err.message.startsWith("FATAL")) throw err;
      console.error(`\n  MAL manga#${row.mal_id} : ${err.message}`);
    }
    if ((i + 1) % 10 === 0 || i === rows.length - 1) {
      process.stdout.write(`\r  ${i + 1}/${rows.length} — ${ok} enrichis, ${gone} disparus de MAL   `);
    }
    await sleep(RATE_LIMIT_MS);
  }
  console.log("");
  return ok;
}

/* ─── Point d'entrée ────────────────────────────────────────────────── */

async function main() {
  if (!MAL_CLIENT_ID) {
    console.error("MAL_CLIENT_ID absent de .env — impossible d'enrichir.");
    process.exit(1);
  }
  if (Number.isFinite(MINUTES)) console.log(`Arrêt automatique dans ${MINUTES} minutes.`);
  if (Number.isFinite(LIMIT)) console.log(`Plafond : ${LIMIT} fiches.`);
  console.log("Interruption possible à tout moment (Ctrl+C) : la reprise repart d'où ça s'est arrêté.");

  let n = 0;
  if (doAnime) n += await enrichAnime();
  if (doManga) n += await enrichManga();
  console.log(`\nTerminé pour cette session : ${n} fiches enrichies.`);
  console.log("Relance la même commande pour continuer.");
}

main().catch((err) => {
  console.error("\nÉchec :", err.message);
  process.exit(1);
});
