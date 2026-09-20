// Supprime des fiches du catalogue anime créées à partir d'une date donnée,
// après avoir vérifié qu'aucune liste d'utilisateur ne les référence.
//
// Pourquoi ce script existe : le 2026-09-20, un premier essai de création de
// fiches depuis Anime News Network a rapproché les œuvres sur leur seul titre
// principal. ANN nommant ses fiches en anglais ("Classroom of the Elite") là
// où le catalogue porte le romaji ("Youkoso Jitsuryoku Shijou Shugi no
// Kyoushitsu e"), 48 des 135 fiches créées étaient des doublons. Le
// rapprochement a été corrigé (sync-ann.mjs), restait à annuler l'essai.
//
// Les identifiants du catalogue ne doivent JAMAIS changer pour une œuvre
// qu'un utilisateur a déjà en liste : d'où la vérification, et d'où le fait
// que ce script ne touche QUE des fiches créées récemment, jamais le fond du
// catalogue.
//
// Usage :
//   node scripts/purge-fiches-annulees.mjs --depuis 2026-09-20T13:00:00Z
//   node scripts/purge-fiches-annulees.mjs --depuis 2026-09-20T13:00:00Z --go

import { supabaseAdmin } from "./lib/supabaseAdmin.mjs";

const args = process.argv.slice(2);
const GO = args.includes("--go");
const depuis = args[args.indexOf("--depuis") + 1];

if (!depuis || !args.includes("--depuis")) {
  console.error("Il manque --depuis <date ISO>, par exemple --depuis 2026-09-20T13:00:00Z");
  process.exit(1);
}

// Plage réservée aux œuvres connues seulement d'Anime News Network.
const ANN_MIN = 800_000_000;
const ANN_MAX = 900_000_000;

const { data: fiches, error } = await supabaseAdmin
  .from("catalog_anime")
  .select("id, ann_id, title_romaji, created_at")
  .gte("id", ANN_MIN)
  .lt("id", ANN_MAX)
  .gte("created_at", depuis)
  .order("id");

if (error) {
  console.error("Lecture impossible :", error.message);
  process.exit(1);
}

console.log(`${fiches.length} fiche(s) créée(s) depuis ${depuis} dans la plage ANN.`);
if (fiches.length === 0) process.exit(0);

const ids = fiches.map((f) => f.id);

// Garde-fou : une fiche référencée par un utilisateur ne doit jamais partir,
// sinon son entrée de liste devient orpheline et s'affiche « Inconnu ».
let bloquees = 0;
for (const [table, colonne] of [
  ["watchlist", "anilist_id"],
  ["collection_items", "anilist_id"],
  ["episode_logs", "anilist_id"],
  ["activity_events", "anilist_id"],
]) {
  const { data, error: e } = await supabaseAdmin.from(table).select(colonne).in(colonne, ids);
  if (e) {
    console.error(`Vérification ${table} impossible : ${e.message} — on s'arrête par prudence.`);
    process.exit(1);
  }
  console.log(`  références dans ${table} : ${data.length}`);
  bloquees += data.length;
}

const { data: favoris } = await supabaseAdmin.from("profiles").select("favorite_animes");
const enFavoris = (favoris || []).flatMap((p) => p.favorite_animes || []).filter((f) => ids.includes(Number(f)));
console.log(`  références dans les favoris de profil : ${enFavoris.length}`);
bloquees += enFavoris.length;

if (bloquees > 0) {
  console.error("\nAu moins une fiche est déjà utilisée : suppression annulée.");
  process.exit(1);
}

console.log("\nAucune de ces fiches n'est utilisée par un compte.");
console.log("Exemples :", fiches.slice(0, 5).map((f) => `ANN#${f.ann_id} ${f.title_romaji}`).join(" | "));

if (!GO) {
  console.log("\nSimulation : rien n'a été supprimé. Relance avec --go pour supprimer.");
  process.exit(0);
}

const { data: supprimees, error: eDel } = await supabaseAdmin
  .from("catalog_anime")
  .delete()
  .gte("id", ANN_MIN)
  .lt("id", ANN_MAX)
  .gte("created_at", depuis)
  .select("id");

if (eDel) {
  console.error("Suppression impossible :", eDel.message);
  process.exit(1);
}
console.log(`${supprimees.length} fiche(s) supprimée(s).`);
