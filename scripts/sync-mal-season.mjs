// Filet de sécurité sur les nouveautés : crée les fiches des saisons proches
// que le catalogue ne connaît pas encore.
//
// Pourquoi : anime-offline-database, qui a servi de socle, est archivée depuis
// le 2026-07-04. Anime News Network prend le relais pour créer des fiches
// (voir sync-ann.mjs), mais son encyclopédie ne couvre que ~12 800 anime
// contre ~30 000 chez MyAnimeList. Mesuré le 2026-09-20 : il manquait 9 titres
// sur 89 pour l'automne 2026, et 86 sur 286 pour l'été 2026.
//
// Ce script ne fait que CRÉER des fiches minimales (titre, type, saison,
// identifiant MyAnimeList) sans mal_synced_at : enrich-mal.mjs les remplit
// donc entièrement la nuit suivante, et sync-ann.mjs les reliera à ANN si
// l'œuvre y figure. Aucune fiche existante n'est modifiée.
//
// Attention, rappel : l'accord d'utilisation de l'API MyAnimeList interdit
// l'usage commercial sans autorisation écrite. ANN doit rester la source
// principale ; ce script n'est qu'un complément de couverture.
//
// Usage :
//   node scripts/sync-mal-season.mjs             # 6 saisons autour d'aujourd'hui
//   node scripts/sync-mal-season.mjs --dry-run   # n'écrit rien
//   node scripts/sync-mal-season.mjs --saisons 8 # remonte plus loin

import { supabaseAdmin, sleep, upsertInChunks } from "./lib/supabaseAdmin.mjs";
import { fromMalId, titleKey } from "./lib/ids.mjs";

const MAL_CLIENT_ID = process.env.MAL_CLIENT_ID;
const RATE_LIMIT_MS = 1100;
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const NB_SAISONS = (() => {
  const i = args.indexOf("--saisons");
  const n = i === -1 ? NaN : parseInt(args[i + 1], 10);
  // Six saisons : une en arrière et quatre en avant. Avec quatre seulement,
  // la saison encore lointaine (printemps 2027 au 2026-09-20) restait hors
  // couverture, or c'est là que sortent les annonces les plus attendues.
  return Number.isFinite(n) ? n : 6;
})();

const SAISONS = ["winter", "spring", "summer", "fall"];
const ENUM = { winter: "WINTER", spring: "SPRING", summer: "SUMMER", fall: "FALL" };

// Types MyAnimeList -> enum interne (voir FORMAT_LABELS dans src/lib/catalog.js).
const TYPE_MAP = {
  tv: "TV",
  tv_special: "SPECIAL",
  movie: "MOVIE",
  ova: "OVA",
  ona: "ONA",
  special: "SPECIAL",
  music: "MUSIC",
  pv: "SPECIAL",
  cm: "SPECIAL",
};

const STATUS_MAP = {
  currently_airing: "RELEASING",
  finished_airing: "FINISHED",
  not_yet_aired: "NOT_YET_RELEASED",
};

// Les saisons à couvrir : la précédente, l'actuelle, et les suivantes.
function saisonsACouvrir(nb) {
  const now = new Date();
  let idx = Math.floor(now.getUTCMonth() / 3);
  let annee = now.getUTCFullYear();
  // On démarre une saison en arrière : les fiches d'une saison en cours
  // continuent d'être créées sur MyAnimeList après son démarrage.
  idx -= 1;
  if (idx < 0) {
    idx = 3;
    annee -= 1;
  }
  const out = [];
  for (let i = 0; i < nb; i++) {
    out.push({ annee, saison: SAISONS[idx] });
    idx += 1;
    if (idx > 3) {
      idx = 0;
      annee += 1;
    }
  }
  return out;
}

async function malSaison(annee, saison) {
  const titres = [];
  let url =
    `https://api.myanimelist.net/v2/anime/season/${annee}/${saison}` +
    `?limit=500&fields=id,title,alternative_titles,media_type,status,num_episodes,start_date,end_date,start_season`;
  while (url) {
    const res = await fetch(url, { headers: { "X-MAL-CLIENT-ID": MAL_CLIENT_ID } });
    if (res.status === 401 || res.status === 403) {
      throw new Error("FATAL: MyAnimeList a refusé la requête — vérifie MAL_CLIENT_ID.");
    }
    // Une saison trop lointaine n'existe pas encore chez MyAnimeList : ce
    // n'est pas une erreur, il n'y a simplement rien à récupérer.
    if (res.status === 404) return titres;
    if (!res.ok) throw new Error(`HTTP ${res.status} sur ${annee}/${saison}`);
    const json = await res.json();
    titres.push(...(json.data || []).map((d) => d.node));
    url = json.paging?.next || null;
    await sleep(RATE_LIMIT_MS);
  }
  return titres;
}

// Dates partielles ("2026-10") refusées par une colonne `date` Postgres.
function normalizeDate(d) {
  if (!d) return null;
  const parts = d.split("-");
  while (parts.length < 3) parts.push("01");
  return parts.join("-");
}

// Fiches du catalogue qui n'ont pas encore d'identifiant MyAnimeList,
// indexées par titre. Sans cela, une œuvre déjà créée par Anime News Network
// (qui ne fournit pas de mal_id) serait recréée ici : deux fiches pour la même
// série, et des identifiants qui ne pourront plus jamais bouger.
async function fichesSansMalId() {
  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabaseAdmin
      .from("catalog_anime")
      .select("id, title_romaji, title_english, title_native, start_date")
      .is("mal_id", null)
      .order("id")
      .range(from, from + page - 1);
    if (error) throw new Error(`Lecture des fiches sans mal_id : ${error.message}`);
    rows.push(...data);
    if (data.length < page) break;
  }
  const byKey = new Map();
  for (const r of rows) {
    for (const t of [r.title_romaji, r.title_english, r.title_native]) {
      const k = titleKey(t);
      if (!k) continue;
      if (!byKey.has(k)) byKey.set(k, []);
      if (!byKey.get(k).includes(r)) byKey.get(k).push(r);
    }
  }
  return byKey;
}

// Même règle que sync-ann.mjs : titre identique une fois normalisé, et année
// de début compatible. En cas d'ambiguïté, on ne fait rien.
function chercheExistante(titres, byKey, annee) {
  const cles = new Set();
  for (const t of titres) {
    const k = titleKey(t);
    if (k) cles.add(k);
  }
  const candidats = [];
  for (const k of cles) for (const r of byKey.get(k) || []) if (!candidats.includes(r)) candidats.push(r);
  const plausibles = candidats.filter((r) => {
    const y = r.start_date ? parseInt(r.start_date.slice(0, 4), 10) : null;
    return !annee || !y || Math.abs(y - annee) <= 1;
  });
  return plausibles.length === 1 ? plausibles[0] : null;
}

async function malIdsConnus(ids) {
  const connus = new Set();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabaseAdmin
      .from("catalog_anime")
      .select("mal_id")
      .in("mal_id", ids.slice(i, i + 200));
    if (error) throw new Error(`Lecture catalog_anime : ${error.message}`);
    for (const r of data) connus.add(r.mal_id);
  }
  return connus;
}

async function main() {
  if (!MAL_CLIENT_ID) {
    console.error("MAL_CLIENT_ID absent — impossible d'interroger MyAnimeList.");
    process.exit(1);
  }

  const saisons = saisonsACouvrir(NB_SAISONS);
  console.log(`Saisons couvertes : ${saisons.map((s) => `${s.saison} ${s.annee}`).join(", ")}`);

  const parMalId = new Map();
  for (const { annee, saison } of saisons) {
    const titres = await malSaison(annee, saison);
    console.log(`  ${saison} ${annee} : ${titres.length} titres annoncés par MyAnimeList.`);
    // Une même œuvre peut apparaître dans deux saisons : la première gagne.
    for (const t of titres) if (!parMalId.has(t.id)) parMalId.set(t.id, t);
  }

  const connus = await malIdsConnus([...parMalId.keys()]);
  const manquants = [...parMalId.values()].filter((t) => !connus.has(t.id));
  console.log(
    `\n${parMalId.size} titres distincts, ${connus.size} déjà au catalogue, ${manquants.length} à créer.`,
  );
  if (manquants.length === 0) return;

  const sansMalId = await fichesSansMalId();
  const lignes = [];
  const rattachements = [];
  for (const t of manquants) {
    const alt = t.alternative_titles || {};
    const annee = t.start_season?.year || (t.start_date ? parseInt(t.start_date.slice(0, 4), 10) : null);
    const deja = chercheExistante([t.title, alt.en, alt.ja], sansMalId, annee);
    if (deja) {
      // L'œuvre existe déjà sans identifiant MyAnimeList : on la relie au lieu
      // d'en créer une deuxième.
      rattachements.push({ id: deja.id, mal_id: t.id });
      continue;
    }
    const id = fromMalId(t.id);
    if (!id) continue;
    lignes.push({
      id,
      mal_id: t.id,
      title_romaji: t.title || null,
      title_english: alt.en || null,
      title_native: alt.ja || null,
      synonyms: alt.synonyms || [],
      type: TYPE_MAP[t.media_type] || null,
      status: STATUS_MAP[t.status] || null,
      episodes: t.num_episodes || null,
      start_date: normalizeDate(t.start_date),
      end_date: normalizeDate(t.end_date),
      season: t.start_season?.season ? ENUM[t.start_season.season] : null,
      season_year: t.start_season?.year || null,
      last_synced_at: new Date().toISOString(),
      // Volontairement pas de mal_synced_at : enrich-mal.mjs traitera ces
      // fiches comme neuves et les remplira (synopsis, genres, score, jaquette).
    });
  }

  console.log(
    "Exemples :",
    lignes.slice(0, 5).map((l) => `${l.title_romaji} (${l.type || "?"}, ${l.season || "?"} ${l.season_year || ""})`).join(" | "),
  );

  if (rattachements.length) {
    console.log(`${rattachements.length} fiche(s) existante(s) vont recevoir leur identifiant MyAnimeList au lieu d'être dupliquée(s).`);
  }

  if (DRY) {
    console.log(`\nSimulation : ${lignes.length} fiches auraient été créées, rien n'a été écrit.`);
    return;
  }

  if (rattachements.length) {
    const faits = await upsertInChunks("catalog_anime", rattachements);
    console.log(`${faits} fiche(s) existante(s) reliée(s) à MyAnimeList.`);
  }

  const done = await upsertInChunks("catalog_anime", lignes);
  console.log(`\n${done} fiches créées. Elles seront enrichies par enrich-mal.mjs à la prochaine exécution.`);
}

main().catch((err) => {
  console.error("Échec :", err.message);
  process.exit(1);
});
