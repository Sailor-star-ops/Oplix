// Calcule un score de tendance pour l'accueil, la recherche et les suggestions.
//
// LE PROBLÈME. AniList calculait sa tendance sur l'activité de ses propres
// utilisateurs, sur une fenêtre glissante. Oplix n'a pas encore assez
// d'utilisateurs pour ça, et un classement de popularité MyAnimeList est
// FIGÉ : il donne toujours les mêmes dix titres, jamais ce qui bouge.
//
// LA SOLUTION, en deux temps.
//
//   1. MAINTENANT — un score composite qui, à défaut de mesurer un mouvement,
//      mesure la PERTINENCE DU MOMENT : une série en cours de diffusion cette
//      saison passe devant un classique terminé il y a quinze ans, même si le
//      classique est plus populaire dans l'absolu. C'est ce qui donne une
//      page d'accueil vivante dès le premier lancement.
//
//   2. DÈS LA DEUXIÈME SYNCHRONISATION — un vrai signal de mouvement. Chaque
//      exécution dépose un relevé dans catalog_trend_snapshot ; à partir du
//      second, on mesure la PROGRESSION du rang et du nombre de membres entre
//      deux relevés. Une œuvre qui gagne 400 places en une semaine grimpe,
//      même si elle reste 800e au classement absolu. C'est ça, une tendance.
//
// Le passage de l'un à l'autre est automatique : dès qu'un relevé antérieur
// existe pour une fiche, sa composante « mouvement » entre dans le calcul.
//
// Usage :
//   node scripts/compute-trending.mjs            # relevé + calcul, anime et manga
//   node scripts/compute-trending.mjs --no-snapshot   # recalcul seul
//   node scripts/compute-trending.mjs --window 14     # comparer à ~14 jours

import { supabaseAdmin, upsertInChunks } from "./lib/supabaseAdmin.mjs";

const args = process.argv.slice(2);
const NO_SNAPSHOT = args.includes("--no-snapshot");
const WINDOW_DAYS = (() => {
  const i = args.indexOf("--window");
  const n = i !== -1 ? parseInt(args[i + 1], 10) : NaN;
  return Number.isFinite(n) ? n : 10;
})();

const SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"];
function currentSeason() {
  const now = new Date();
  return { season: SEASONS[Math.floor(now.getMonth() / 3)], year: now.getFullYear() };
}

// `orderCols` doit former une clé UNIQUE : sans tri stable, la pagination
// renvoie des lignes en double et en omet d'autres. catalog_trend_snapshot n'a
// pas de colonne id — sa clé est (media_type, media_id, captured_on).
async function fetchAll(table, cols, filter, orderCols = ["id"]) {
  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    let q = supabaseAdmin.from(table).select(cols);
    for (const col of orderCols) q = q.order(col, { ascending: true });
    q = q.range(from, from + page - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table} : ${error.message}`);
    rows.push(...data);
    if (data.length < page) break;
  }
  return rows;
}

/* ─── Composante 1 : pertinence du moment ───────────────────────────── */

// Notoriété, ramenée à une échelle lisible. Le logarithme évite qu'un titre à
// 3 millions de membres écrase tout le reste : entre 10 000 et 100 000 membres
// il y a autant d'écart qu'entre 100 000 et 1 million.
function notoriety(row) {
  if (row.members > 0) return Math.log10(row.members); // ~3 à ~7
  if (row.popularity > 0) return Math.max(0, 5.5 - Math.log10(row.popularity)); // rang : plus petit = mieux
  return 0;
}

// Ce qui sort maintenant compte plus que ce qui est sorti il y a dix ans.
function freshness(row, cur) {
  if (row.status === "RELEASING") return 3.2;
  if (row.season === cur.season && row.season_year === cur.year) return 2.8;
  if (row.status === "NOT_YET_RELEASED") return 1.8;
  if (!row.start_date) return 0;
  const years = (Date.now() - new Date(row.start_date).getTime()) / (365.25 * 24 * 3600 * 1000);
  if (years < 0) return 1.8;
  if (years < 1) return 1.4;
  if (years < 3) return 0.6;
  return 0;
}

// La qualité départage à notoriété comparable, sans dominer le calcul.
const quality = (row) => (row.score > 0 ? (row.score - 6.5) * 0.45 : 0);

/* ─── Composante 2 : mouvement réel entre deux relevés ──────────────── */

// Progression relative, bornée : une œuvre qui passe de la 1200e à la 800e
// place gagne autant qu'une qui passe de la 30e à la 20e. C'est l'ampleur
// relative du mouvement qui fait la tendance, pas la position absolue.
function momentum(row, prev) {
  // Pas de mouvement mesuré tant que les DEUX relevés ne portent pas un volume
  // de membres. `members` n'est écrit que par enrich-mal.mjs, donc sa présence
  // garantit un rang MyAnimeList frais. Sans cette garde, pendant le rattrapage
  // de l'enrichissement, un rang périmé (importé il y a des semaines) remplacé
  // par le rang du jour passerait pour une progression — des milliers de
  // fausses « tendances » la nuit suivante.
  if (!prev || !(prev.members > 0) || !(row.members > 0)) return null;
  let m = 0;
  if (prev.popularity > 0 && row.popularity > 0) {
    m += Math.max(-1, Math.min(1, (prev.popularity - row.popularity) / prev.popularity)) * 6;
  }
  if (prev.members > 0 && row.members > 0) {
    m += Math.max(-1, Math.min(1, (row.members - prev.members) / prev.members)) * 12;
  }
  return m;
}

/* ─── Retention des releves ─────────────────────────────────────────── */

// 38 000 releves deposes chaque jour, soit ~1,15 million de lignes par mois,
// pour une fenetre de comparaison qui n'en utilise que 10 jours. Sans purge,
// le demi-Go de l'offre gratuite Supabase y passe en quelques mois.
const KEEP_DAYS = 45;

async function purgeOldSnapshots(mediaType) {
  const limite = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { error, count } = await supabaseAdmin
    .from("catalog_trend_snapshot")
    .delete({ count: "exact" })
    .eq("media_type", mediaType)
    .lt("captured_on", limite);
  if (error) console.error(`  purge des releves : ${error.message}`);
  else console.log(`${count ?? 0} releves de plus de ${KEEP_DAYS} jours supprimes.`);
}

/* ─── Traitement d'une table ────────────────────────────────────────── */

async function processTable(table, mediaType) {
  const cur = currentSeason();
  const isAnime = mediaType === "ANIME";
  const cols = isAnime
    ? "id, members, popularity, score, status, season, season_year, start_date"
    : "id, members, popularity, score, status, start_date";

  const rows = await fetchAll(table, cols);
  console.log(`\n═══ ${mediaType} ═══\n${rows.length} fiches.`);

  // Relevé antérieur le plus proche de la fenêtre demandée.
  const since = new Date(Date.now() - WINDOW_DAYS * 2 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const history = await fetchAll(
    "catalog_trend_snapshot",
    "media_id, popularity, members, captured_on",
    (q) => q.eq("media_type", mediaType).gte("captured_on", since).lt("captured_on", today),
    ["media_id", "captured_on"], // unique pour un media_type donné
  );
  const prevById = new Map();
  for (const h of history) {
    const kept = prevById.get(h.media_id);
    // Le plus ancien de la fenêtre : l'écart mesuré est ainsi le plus large.
    if (!kept || h.captured_on < kept.captured_on) prevById.set(h.media_id, h);
  }
  console.log(`${prevById.size} fiches disposent d'un relevé antérieur (fenêtre ${WINDOW_DAYS}j).`);

  const updates = [];
  let withMomentum = 0;
  for (const row of rows) {
    const base = notoriety(row) + (isAnime ? freshness(row, cur) : freshness(row, cur)) + quality(row);
    const mv = momentum(row, prevById.get(row.id));
    if (mv !== null) withMomentum++;
    // Le mouvement, quand il existe, pèse davantage que la position acquise :
    // c'est la différence entre « populaire » et « en train de monter ».
    const score = mv === null ? base : base * 0.55 + mv;
    updates.push({ id: row.id, trending_score: Number(score.toFixed(4)) });
  }

  const done = await upsertInChunks(table, updates);
  console.log(`${done} scores de tendance écrits (${withMomentum} intègrent un mouvement réel).`);

  if (!NO_SNAPSHOT) {
    // On ne relève que les fiches porteuses d'un signal : relever 30 000 lignes
    // vides chaque semaine ferait grossir la table pour rien.
    const snaps = rows
      .filter((r) => r.popularity > 0 || r.members > 0)
      .map((r) => ({
        media_type: mediaType,
        media_id: r.id,
        captured_on: today,
        popularity: r.popularity ?? null,
        members: r.members ?? null,
        score: r.score ?? null,
      }));
    let written = 0;
    for (let i = 0; i < snaps.length; i += 500) {
      const { error } = await supabaseAdmin
        .from("catalog_trend_snapshot")
        .upsert(snaps.slice(i, i + 500), { onConflict: "media_type,media_id,captured_on" });
      if (error) console.error(`  relevé ${i} : ${error.message}`);
      else written += Math.min(500, snaps.length - i);
    }
    console.log(`${written} relevés déposés pour aujourd'hui.`);
  }

  await purgeOldSnapshots(mediaType);

  const top = [...updates].sort((a, b) => b.trending_score - a.trending_score).slice(0, 5);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const { data: titles } = await supabaseAdmin
    .from(table)
    .select("id, title_romaji, title_english")
    .in("id", top.map((t) => t.id));
  console.log("Tête de classement :");
  for (const t of top) {
    const ti = (titles || []).find((x) => x.id === t.id);
    const r = byId.get(t.id);
    console.log(
      `  ${t.trending_score.toFixed(2).padStart(6)}  ${ti?.title_english || ti?.title_romaji} ` +
        `(${r?.status ?? "?"}, rang ${r?.popularity ?? "—"})`,
    );
  }
}

async function main() {
  console.log(`Fenêtre de comparaison : ${WINDOW_DAYS} jours.`);
  await processTable("catalog_anime", "ANIME");
  await processTable("catalog_manga", "MANGA");
  console.log(
    "\nTendance recalculée.\n" +
      "Au premier passage le score ne mesure que la pertinence du moment ;\n" +
      "dès la prochaine exécution il intègre le mouvement réel entre deux relevés.",
  );
}

main().catch((err) => {
  console.error("Échec du calcul de tendance :", err.message);
  process.exit(1);
});
