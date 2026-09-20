// Fusionne les fiches manga qui désignent la même œuvre.
//
// D'où viennent ces doublons : le catalogue manga a deux sources qui ne
// partagent aucun identifiant commun (Wikidata via MyAnimeList d'un côté,
// Anime News Network de l'autre). Le rapprochement se fait sur le titre
// normalisé, et il échoue dès qu'une ponctuation ou une transcription diffère.
//
// Ce script est volontairement timide. Mesuré le 2026-09-20 : sur 621 groupes
// de titres identiques, seuls 59 sont de vrais doublons. Les 562 autres sont
// des œuvres réellement distinctes qui portent le même nom — une série et sa
// suite, un manga et son spin-off — et les fusionner détruirait des fiches.
//
// Deux groupes seulement sont considérés comme fusionnables :
//   - même identifiant MyAnimeList (preuve directe) ;
//   - même titre normalisé, SANS identifiant contradictoire (deux mal_id
//     différents = deux œuvres différentes), ET avec des années de début
//     compatibles (moins de deux ans d'écart).
//
// La fiche conservée garde son identifiant : `catalog_manga.id` est référencé
// par les watchlists, les collections et les favoris, et ne doit jamais
// changer. Une fiche référencée par un compte n'est jamais supprimée : si un
// doublon est déjà dans une liste, c'est LUI qui devient la fiche conservée.
//
// Usage :
//   node scripts/fusion-doublons-manga.mjs             # simulation
//   node scripts/fusion-doublons-manga.mjs --go        # applique

import { supabaseAdmin } from "./lib/supabaseAdmin.mjs";

const GO = process.argv.includes("--go");

// Colonnes recopiées sur la fiche conservée quand elle ne les a pas.
const CHAMPS = [
  "mal_id", "ann_id", "title_romaji", "title_english", "title_native", "synonyms",
  "authors", "publisher", "status", "volumes", "chapters", "demographic", "genres",
  "synopsis", "cover_url", "start_date", "country_of_origin", "titles", "staff",
  "external_links", "copyright_notice", "score", "popularity", "members",
  "rank_overall", "tags", "trending_score",
];

const vide = (v) => v == null || v === "" || (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

async function toutesLesFiches() {
  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabaseAdmin
      .from("catalog_manga")
      .select("*")
      .order("id")
      .range(from, from + page - 1);
    if (error) throw new Error(`Lecture catalog_manga : ${error.message}`);
    rows.push(...data);
    if (data.length < page) break;
  }
  return rows;
}

// Fiches déjà présentes dans une liste, une collection ou des favoris.
async function fichesUtilisees(ids) {
  const utilisees = new Set();
  for (const [table, colonne] of [
    ["watchlist", "anilist_id"],
    ["collection_items", "anilist_id"],
    ["episode_logs", "anilist_id"],
    ["activity_events", "anilist_id"],
  ]) {
    for (let i = 0; i < ids.length; i += 300) {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select(colonne)
        .in(colonne, ids.slice(i, i + 300));
      if (error) throw new Error(`Vérification ${table} : ${error.message}`);
      for (const r of data) utilisees.add(r[colonne]);
    }
  }
  const { data: profils } = await supabaseAdmin.from("profiles").select("favorite_animes");
  for (const p of profils || []) for (const f of p.favorite_animes || []) utilisees.add(Number(f));
  return utilisees;
}

const annee = (r) => (r.start_date ? parseInt(r.start_date.slice(0, 4), 10) : null);

function groupeFusionnable(g) {
  const mals = [...new Set(g.map((r) => r.mal_id).filter(Boolean))];
  const anns = [...new Set(g.map((r) => r.ann_id).filter(Boolean))];
  if (mals.length > 1 || anns.length > 1) return false;
  const annees = g.map(annee).filter(Boolean);
  return annees.length < 2 || Math.max(...annees) - Math.min(...annees) <= 1;
}

// Nombre de champs renseignés : sert à départager deux fiches également
// légitimes — on garde la plus complète.
const richesse = (r) => CHAMPS.filter((c) => !vide(r[c])).length;

function choisirConservee(g, utilisees) {
  const enListe = g.filter((r) => utilisees.has(r.id));
  // Si plusieurs fiches du groupe sont utilisées, on ne touche à rien :
  // supprimer l'une d'elles orphelinerait la liste d'un utilisateur.
  if (enListe.length > 1) return null;
  if (enListe.length === 1) return enListe[0];
  return [...g].sort((a, b) => {
    if (!!b.mal_id !== !!a.mal_id) return b.mal_id ? 1 : -1;
    const dr = richesse(b) - richesse(a);
    if (dr !== 0) return dr;
    return a.id - b.id; // à égalité, la plus ancienne
  })[0];
}

const rows = await toutesLesFiches();
console.log(`${rows.length} fiches manga lues.`);

// Deux indices se recoupent : le titre normalise et l'identifiant
// MyAnimeList. Une fiche Wikidata (qui a un mal_id) et une fiche ANN (qui n'en
// a pas) portant le meme titre doivent finir dans le MEME groupe — les
// indexer separement, c'est passer a cote de la quasi-totalite des doublons.
const parent = new Map();
const trouve = (x) => {
  while (parent.get(x) !== x) {
    parent.set(x, parent.get(parent.get(x)));
    x = parent.get(x);
  }
  return x;
};
const unir = (a, b) => {
  const ra = trouve(a);
  const rb = trouve(b);
  if (ra !== rb) parent.set(ra, rb);
};
for (const r of rows) parent.set(r.id, r.id);

const premierParCle = new Map();
for (const r of rows) {
  for (const cle of [r.title_key ? `titre:${r.title_key}` : null, r.mal_id ? `mal:${r.mal_id}` : null]) {
    if (!cle) continue;
    if (premierParCle.has(cle)) unir(r.id, premierParCle.get(cle));
    else premierParCle.set(cle, r.id);
  }
}

const groupes = new Map();
for (const r of rows) {
  const racine = trouve(r.id);
  if (!groupes.has(racine)) groupes.set(racine, []);
  groupes.get(racine).push(r);
}

// Un groupe relie par le titre peut melanger une vraie paire de doublons et
// une oeuvre homonyme sans rapport : rejeter le groupe entier laissait passer
// des doublons evidents (deux fiches au meme mal_id, bloquees parce qu'une
// troisieme fiche homonyme trainait dans le groupe). On decoupe donc par
// identifiant, et les fiches sans identifiant sont ecartees des qu'il y a
// plus d'un paquet possible.
function sousGroupes(g) {
  const mals = [...new Set(g.map((r) => r.mal_id).filter(Boolean))];
  const anns = [...new Set(g.map((r) => r.ann_id).filter(Boolean))];
  if (mals.length <= 1 && anns.length <= 1) return [g];
  const paquets = [];
  for (const mal of mals) paquets.push(g.filter((r) => r.mal_id === mal));
  for (const ann of anns) paquets.push(g.filter((r) => !r.mal_id && r.ann_id === ann));
  return paquets;
}

const candidats = [...groupes.values()]
  .flatMap((g) => (g.length > 1 ? sousGroupes(g) : []))
  .filter((g) => g.length > 1 && groupeFusionnable(g));
console.log(`${candidats.length} groupes fusionnables.`);
if (candidats.length === 0) process.exit(0);

const utilisees = await fichesUtilisees(candidats.flat().map((r) => r.id));
console.log(`${utilisees.size} fiche(s) du lot sont déjà dans une liste d'utilisateur.`);

const misesAJour = [];
const aSupprimer = [];
const ignores = [];

for (const g of candidats) {
  const gardee = choisirConservee(g, utilisees);
  if (!gardee) {
    ignores.push(g);
    continue;
  }
  const autres = g.filter((r) => r.id !== gardee.id);
  // Une fiche utilisée par un compte n'est jamais supprimée.
  if (autres.some((r) => utilisees.has(r.id))) {
    ignores.push(g);
    continue;
  }

  const complement = {};
  for (const champ of CHAMPS) {
    if (!vide(gardee[champ])) continue;
    const source = autres.find((r) => !vide(r[champ]));
    if (source) complement[champ] = source[champ];
  }
  if (Object.keys(complement).length > 0) {
    misesAJour.push({ id: gardee.id, ...complement });
  }
  aSupprimer.push(...autres.map((r) => r.id));
}

console.log(`\n${aSupprimer.length} fiche(s) en double à supprimer, ${misesAJour.length} fiche(s) conservée(s) à compléter, ${ignores.length} groupe(s) laissés tels quels.`);
for (const g of candidats.slice(0, 6)) {
  console.log(`  "${g[0].title_romaji}" : ${g.map((r) => `#${r.id}${r.mal_id ? " mal=" + r.mal_id : ""}${r.ann_id ? " ann=" + r.ann_id : ""}`).join(" + ")}`);
}

if (!GO) {
  console.log("\nSimulation : rien n'a été écrit. Relance avec --go pour appliquer.");
  process.exit(0);
}

// Les objets d'un même lot doivent porter les mêmes clés (voir upsertInChunks) :
// chaque complément est donc écrit séparément.
let completees = 0;
for (const maj of misesAJour) {
  const { id, ...champs } = maj;
  const { error } = await supabaseAdmin.from("catalog_manga").update(champs).eq("id", id);
  if (error) console.error(`  complément #${id} : ${error.message}`);
  else completees++;
}
console.log(`${completees} fiche(s) complétée(s).`);

let supprimees = 0;
for (let i = 0; i < aSupprimer.length; i += 100) {
  const lot = aSupprimer.slice(i, i + 100);
  const { data, error } = await supabaseAdmin.from("catalog_manga").delete().in("id", lot).select("id");
  if (error) console.error(`  suppression ${i} : ${error.message}`);
  else supprimees += data.length;
}
console.log(`${supprimees} doublon(s) supprimé(s).`);
