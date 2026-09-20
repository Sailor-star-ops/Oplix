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
  "alternative_titles", "status", "num_episodes",
].join(",");

// Le statut et le nombre d'épisodes ne venaient que d'anime-offline-database,
// figé depuis le 2026-07-04 : des séries terminées restaient « en cours » et
// des séries diffusées restaient « à venir ». MyAnimeList, lui, est à jour.
const ANIME_STATUS_MAP = {
  currently_airing: "RELEASING",
  finished_airing: "FINISHED",
  not_yet_aired: "NOT_YET_RELEASED",
};

// Une fiche en cours de diffusion (ou à venir) change de statut, de créneau et
// de nombre d'épisodes en permanence : on la repasse régulièrement, au lieu de
// la considérer comme réglée pour toujours. Le plafond garde le job court —
// les minutes GitHub Actions ne sont pas illimitées.
const REFRESH_AFTER_DAYS = 7;
const REFRESH_MAX = { catalog_anime: 400, catalog_manga: 200 };

// Reparation ponctuelle. Jusqu'au 2026-09-20, la table de correspondance des
// oeuvres liees etait plafonnee a 1000 lignes : 29 668 fiches ont ete ecrites
// avec une liste de relations vide, et rien ne les reprenait (elles comptent
// comme deja synchronisees). On les repasse par lots, les plus consultees
// d'abord. Chaque fiche traitee ressort du lot (son mal_synced_at devient
// recent), donc la reparation se termine d'elle-meme et ne coute plus rien.
const RELATIONS_BUG_UNTIL = "2026-09-20T09:00:00Z";
const REPAIR_MAX = 1000;

async function repairRows(cols) {
  const { data, error } = await supabaseAdmin
    .from("catalog_anime")
    .select(cols)
    .not("mal_id", "is", null)
    .lt("mal_synced_at", RELATIONS_BUG_UNTIL)
    .eq("relations", "[]")
    .order("popularity", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true })
    .limit(REPAIR_MAX);
  if (error) throw new Error(`catalog_anime (reparation des relations) : ${error.message}`);
  return data || [];
}

const MANGA_FIELDS = [
  "synopsis", "genres", "main_picture", "status", "num_volumes", "num_chapters",
  "nsfw", "mean", "popularity", "rank", "num_list_users", "alternative_titles",
  "start_date", "end_date", "authors{first_name,last_name}",
  // Les œuvres liées d'un manga n'étaient jamais demandées : l'onglet
  // correspondant de la fiche restait vide pour tous les manga.
  "related_manga", "related_anime",
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

// Fiches déjà enrichies mais susceptibles d'avoir changé : celles qui sont en
// cours de diffusion/publication ou pas encore sorties. Les plus anciennement
// synchronisées d'abord, pour que tout le lot finisse par tourner.
async function staleRows(table, cols) {
  const cutoff = new Date(Date.now() - REFRESH_AFTER_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from(table)
    .select(cols)
    .not("mal_id", "is", null)
    .in("status", ["RELEASING", "NOT_YET_RELEASED"])
    .lt("mal_synced_at", cutoff)
    .order("mal_synced_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(REFRESH_MAX[table]);
  if (error) throw new Error(`${table} (rafraîchissement) : ${error.message}`);
  return data || [];
}

// Supabase plafonne une requête à 1000 lignes : sans pagination, la table de
// correspondance des œuvres liées ne couvrait que 1000 des 30 561 anime, et
// presque toutes les relations étaient jetées à l'écriture — définitivement,
// puisque la fiche était ensuite marquée comme synchronisée.
async function malIdMap() {
  const map = new Map();
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabaseAdmin
      .from("catalog_anime")
      .select("id, mal_id")
      .not("mal_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(`Table de correspondance MAL : ${error.message}`);
    for (const r of data) map.set(r.mal_id, r.id);
    if (data.length < page) break;
  }
  return map;
}

/* ─── Anime ─────────────────────────────────────────────────────────── */

async function enrichAnime() {
  const cols =
    "id, mal_id, synopsis, genres, start_date, end_date, title_english, title_native, synonyms, score, status, episodes";
  const pending = await pendingRows("catalog_anime", cols);
  const stale = pending.length ? [] : await staleRows("catalog_anime", cols);
  const repair = pending.length ? [] : await repairRows(cols);
  const rows = [...pending, ...stale, ...repair];
  const { count: total } = await supabaseAdmin
    .from("catalog_anime")
    .select("id", { count: "exact", head: true })
    .not("mal_id", "is", null);
  console.log(
    `\n═══ Anime ═══\n${pending.length} fiches jamais enrichies sur ${total}` +
      (stale.length ? `, plus ${stale.length} fiches en cours/a venir a rafraichir` : "") +
      (repair.length ? `, plus ${repair.length} fiches dont les oeuvres liees sont a reparer` : "") +
      ".",
  );
  if (!rows.length) return 0;

  // Correspondance ID MyAnimeList -> ID catalogue, pour que les œuvres liées
  // pointent vers des lignes réellement présentes en base.
  const malToId = await malIdMap();
  console.log(`${malToId.size} correspondances MAL -> catalogue chargées.`);

  let ok = 0;
  let gone = 0;
  let erreurs = 0;
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
        const { error } = await supabaseAdmin
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
            // Statut et nombre d'épisodes : MyAnimeList est la seule source à
            // jour depuis que le dataset amont est archivé.
            status: ANIME_STATUS_MAP[d.status] || row.status || null,
            episodes: d.num_episodes || row.episodes || null,
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
        // Une erreur d'ecriture ignoree faisait compter comme reussie une fiche
        // qui n'a jamais ete ecrite en base.
        if (error) throw new Error(`ecriture Supabase : ${error.message}`);
        ok++;
      }
    } catch (err) {
      if (err.message.startsWith("FATAL")) throw err;
      erreurs++;
      console.error(`\n  MAL anime#${row.mal_id} : ${err.message}`);
    }
    if ((i + 1) % 10 === 0 || i === rows.length - 1) {
      process.stdout.write(`\r  ${i + 1}/${rows.length} — ${ok} enrichies, ${gone} disparues de MAL   `);
    }
    await sleep(RATE_LIMIT_MS);
  }
  console.log("");
  if (erreurs) console.warn(`  ${erreurs} fiche(s) en erreur : ni enrichies, ni marquees comme faites.`);
  return ok;
}

/* ─── Manga ─────────────────────────────────────────────────────────── */

// Correspondance ID MyAnimeList -> ID catalogue côté manga, pour que les
// œuvres liées pointent vers des lignes réellement présentes en base.
async function malIdMapManga() {
  const map = new Map();
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabaseAdmin
      .from("catalog_manga")
      .select("id, mal_id")
      .not("mal_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(`Table de correspondance manga : ${error.message}`);
    for (const r of data) map.set(r.mal_id, r.id);
    if (data.length < page) break;
  }
  return map;
}

async function enrichManga() {
  const cols =
    "id, mal_id, synopsis, genres, cover_url, status, volumes, chapters, start_date, title_english, title_native, authors";
  const pending = await pendingRows("catalog_manga", cols);
  const stale = pending.length ? [] : await staleRows("catalog_manga", cols);
  const rows = [...pending, ...stale];
  const { count: total } = await supabaseAdmin
    .from("catalog_manga")
    .select("id", { count: "exact", head: true })
    .not("mal_id", "is", null);
  console.log(`\n═══ Manga ═══\n${rows.length} fiches restantes sur ${total} à enrichir.`);
  if (!rows.length) return 0;

  // Une œuvre liée peut être un manga (suite, spin-off) ou l'anime tiré du
  // manga : les deux tables sont donc nécessaires.
  const [mangaIds, animeIds] = await Promise.all([malIdMapManga(), malIdMap()]);

  let ok = 0;
  let gone = 0;
  let erreurs = 0;
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
        const { error } = await supabaseAdmin
          .from("catalog_manga")
          .update({
            synopsis: keep(row.synopsis, d.synopsis),
            genres: isEmpty(row.genres) ? (d.genres || []).map((g) => g.name) : row.genres,
            cover_url: keep(row.cover_url, d.main_picture?.large || d.main_picture?.medium),
            status: MANGA_STATUS_MAP[d.status] || row.status || null,
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
            relations: [
              ...(d.related_manga || []).map((r) => ({
                id: mangaIds.get(r.node?.id) ?? null,
                relation_type: r.relation_type,
              })),
              ...(d.related_anime || []).map((r) => ({
                id: animeIds.get(r.node?.id) ?? null,
                relation_type: r.relation_type,
              })),
            ].filter((r) => r.id),
            mal_synced_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        // Une erreur d'ecriture ignoree faisait compter comme reussie une fiche
        // qui n'a jamais ete ecrite en base.
        if (error) throw new Error(`ecriture Supabase : ${error.message}`);
        ok++;
      }
    } catch (err) {
      if (err.message.startsWith("FATAL")) throw err;
      erreurs++;
      console.error(`\n  MAL manga#${row.mal_id} : ${err.message}`);
    }
    if ((i + 1) % 10 === 0 || i === rows.length - 1) {
      process.stdout.write(`\r  ${i + 1}/${rows.length} — ${ok} enrichis, ${gone} disparus de MAL   `);
    }
    await sleep(RATE_LIMIT_MS);
  }
  console.log("");
  if (erreurs) console.warn(`  ${erreurs} fiche(s) en erreur : ni enrichies, ni marquees comme faites.`);
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
