// Enrichissement du catalogue depuis l'Encyclopedia d'Anime News Network.
//
// ANN est aujourd'hui la seule source à la fois vivante, riche et
// explicitement ouverte à l'import en masse : ses conditions d'utilisation
// n'exigent que deux choses, que l'app respecte (voir src/components/Modal.jsx
// et src/components/SourcesNotice.jsx) :
//   1. citer Anime News Network comme source des données ;
//   2. afficher un lien vers la fiche correspondante de l'Encyclopédie.
// Aucune clause commerciale, aucune clause anti-concurrent. ANN documente
// lui-même ce scénario d'import (reports.xml pour la liste, api.xml pour le
// détail, 50 titres par requête, 1 requête/seconde maximum).
//
// Ce que ce script apporte, et que rien d'autre ne fournit légalement :
//   - titres en 9 langues (contre 1 seul aujourd'hui)
//   - équipe technique détaillée et casting, DONT LES VOIX FRANÇAISES
//   - liens officiels, thèmes d'ouverture/fin, mention de copyright
//   - un catalogue manga qui triple de volume
//   - une source qui continue d'être mise à jour, contrairement à
//     anime-offline-database, archivé depuis le 2026-07-04
//
// Usage :
//   node scripts/sync-ann.mjs            # anime puis manga
//   node scripts/sync-ann.mjs --anime    # anime seulement
//   node scripts/sync-ann.mjs --manga    # manga seulement
//   SYNC_LIMIT=100 node scripts/sync-ann.mjs --anime   # run de test

import { supabaseAdmin, sleep, upsertInChunks } from "./lib/supabaseAdmin.mjs";
import { parseAnnResponse, parseAnnReport, parseVintage } from "./lib/annXml.mjs";
import { fromAnnId, titleKey } from "./lib/ids.mjs";
import { normalizeGenres } from "./lib/genres.mjs";

const REPORTS_URL = "https://www.animenewsnetwork.com/encyclopedia/reports.xml";
const DETAIL_URL = "https://cdn.animenewsnetwork.com/encyclopedia/api.xml";
const USER_AGENT = "Oplix-catalog-sync/1.0 (+https://oplix.app)";

// ANN impose une seconde entre deux requêtes, et le dit explicitement.
// On garde une marge : dépasser leur seuil renvoie des 503.
const RATE_LIMIT_MS = 1200;
const BATCH_SIZE = 50; // maximum documenté par ANN

const SYNC_LIMIT = process.env.SYNC_LIMIT ? parseInt(process.env.SYNC_LIMIT, 10) : null;
const args = process.argv.slice(2);
const doAnime = args.length === 0 || args.includes("--anime");
const doManga = args.length === 0 || args.includes("--manga");

/* ─── Accès réseau ──────────────────────────────────────────────────── */

async function annFetch(url, attempt = 1) {
  let res;
  try {
    res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  } catch (err) {
    if (attempt < 3) {
      await sleep(5000 * attempt);
      return annFetch(url, attempt + 1);
    }
    throw err;
  }
  // 503 = seuil de débit dépassé côté ANN : on lève le pied plutôt qu'insister.
  if (res.status === 503 && attempt < 4) {
    await sleep(10_000 * attempt);
    return annFetch(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  return res.text();
}

async function fetchDetails(kind, ids) {
  const qs = ids.map((id) => `${kind}=${id}`).join("&");
  const xml = await annFetch(`${DETAIL_URL}?${qs}`);
  return parseAnnResponse(xml);
}

async function fetchAllRows(table, cols) {
  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    // Tri sur l'id obligatoire : sans lui, la pagination renvoie des doublons.
    const { data, error } = await supabaseAdmin.from(table).select(cols).order("id").range(from, from + page - 1);
    if (error) throw new Error(`${table} : ${error.message}`);
    rows.push(...data);
    if (data.length < page) break;
  }
  return rows;
}

/* ─── Conversion d'une fiche ANN en colonnes ────────────────────────── */

const firstTitle = (titles, lang) => titles[lang]?.[0] || null;

// Regroupe le casting par personnage : ANN liste une ligne par (rôle, langue),
// on veut un personnage avec ses différentes voix — dont la VF, que ni AniList
// ni MyAnimeList n'ont jamais exposée.
function groupCast(cast) {
  // Regroupement insensible à la casse et aux accents : ANN orthographie le
  // même personnage différemment selon le crédit d'où vient la ligne
  // ("Hange Zoe" / "Hange Zoë"), ce qui produisait des doublons à l'affichage.
  // On ne va pas plus loin (pas de rapprochement approximatif) : "Ackerman" et
  // "Ackermann" restent deux entrées, car fusionner sur une ressemblance
  // risquerait de confondre des personnages réellement distincts.
  const byKey = new Map();
  for (const c of cast) {
    const key = titleKey(c.role) || c.role;
    if (!byKey.has(key)) byKey.set(key, new Map());
    const variants = byKey.get(key);
    if (!variants.has(c.role)) variants.set(c.role, []);
    if (c.person) variants.get(c.role).push({ name: c.person, lang: c.lang });
  }

  const rank = (l) => (l === "FR" ? 0 : l === "JA" ? 1 : 2);
  const out = [];
  for (const variants of byKey.values()) {
    // Orthographe retenue : celle du crédit le mieux fourni, donc la principale.
    const [name] = [...variants.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    const actors = [...variants.values()].flat().sort((a, b) => rank(a.lang) - rank(b.lang));
    out.push({ name, actors });
  }
  return out;
}

function annCommonFields(rec) {
  const { start, end } = parseVintage(rec.vintage);
  return {
    ann_id: rec.ann_id,
    titles: rec.titles,
    staff: rec.staff,
    external_links: rec.officialSites.map((s) => ({ label: s.label, url: s.url, lang: s.lang })),
    copyright_notice: rec.copyright || null,
    ann_synced_at: new Date().toISOString(),

    // Colonnes dont ANN est l'unique source : écrites telles quelles, sans
    // passer par prefer(). Elles n'écrasent rien puisque rien d'autre ne les
    // alimente, et c'est ce qui rend la provenance vérifiable — voir
    // supabase_catalog_v4.sql pour le raisonnement complet.
    ann_rating: rec.rating,
    ann_rating_votes: rec.ratingVotes,
    ann_cover_url: rec.pictures[0] || null,
    ann_synopsis: rec.synopsis || null,
    // Normalisé à l'écriture : ANN publie « OC » et « Oc » pour la même
    // valeur, et un filtre qui compare des chaînes exactes laisserait passer
    // la variante minuscule — c'est exactement ce qui était arrivé aux genres.
    // Vocabulaire relevé : AA (tous publics), OC (grands enfants), TA (ados),
    // MA (public averti), AO (adultes uniquement).
    ann_objectionable: rec.objectionable ? String(rec.objectionable).trim().toUpperCase() : null,
    ann_related: rec.related,

    _annSynopsis: rec.synopsis || null,
    _annCover: rec.pictures[0] || null,
    _annStart: start,
    _annEnd: end,
    _annEnglish: firstTitle(rec.titles, "EN"),
    _annNative: firstTitle(rec.titles, "JA"),
  };
}

function isEmpty(v) {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0);
}

// Ne remplace jamais une valeur déjà présente : ANN vient compléter les sources
// existantes, pas les écraser. Rend le script ré-exécutable sans effet de bord
// et sans perdre l'enrichissement MyAnimeList déjà en base.
//
// ATTENTION : renvoie toujours une valeur, et n'omet jamais la clé. Supabase
// construit UNE seule requête par lot, avec l'union des clés de tous les objets
// envoyés : une clé absente d'un objet y est insérée à NULL, ce qui fait échouer
// tout le lot sur les colonnes `not null` (genres, tags, authors, synonyms).
// Tous les objets d'un même lot doivent donc porter exactement les mêmes clés.
function prefer(existing, field, annValue, fallback = null) {
  const current = existing?.[field];
  if (!isEmpty(current)) return current;
  return isEmpty(annValue) ? fallback : annValue;
}

/* ─── Phase anime ───────────────────────────────────────────────────── */

// anime-offline-database étant archivé depuis le 2026-07-04, plus rien ne
// créait de fiche anime : les nouveautés n'entraient jamais au catalogue.
// ANN publie la liste complète de son encyclopédie (reports.xml), exactement
// comme pour le manga : on s'en sert donc aussi pour CRÉER les fiches
// absentes, plus seulement pour enrichir celles qui existent déjà.

// Types ANN -> enum interne (voir FORMAT_LABELS dans src/lib/catalog.js).
const ANN_TYPE_MAP = {
  TV: "TV",
  ONA: "ONA",
  OAV: "OVA",
  OVA: "OVA",
  movie: "MOVIE",
  special: "SPECIAL",
  "TV special": "SPECIAL",
  "music video": "MUSIC",
  omnibus: "SPECIAL",
};

const SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"];

// Saison de diffusion à partir de la date de début (janvier-mars = hiver).
function seasonOf(startDate) {
  if (!startDate) return { season: null, season_year: null };
  const d = new Date(startDate);
  if (Number.isNaN(d.getTime())) return { season: null, season_year: null };
  return { season: SEASONS[Math.floor(d.getUTCMonth() / 3)], season_year: d.getUTCFullYear() };
}

// ANN ne publie pas de statut : on le déduit des dates. Uniquement pour les
// fiches créées ici — celles qui existent déjà tiennent leur statut de
// MyAnimeList, qui est à jour (voir enrich-mal.mjs).
function statusFromDates(start, end) {
  if (!start) return null;
  const now = Date.now();
  if (new Date(start).getTime() > now) return "NOT_YET_RELEASED";
  if (end && new Date(end).getTime() < now) return "FINISHED";
  return end ? "RELEASING" : "FINISHED";
}

// Index de TOUS les titres connus d'une fiche : romaji, anglais, natif et
// synonymes. Indexer un seul titre ne suffit pas — ANN nomme ses fiches en
// anglais ("Classroom of the Elite") là où le catalogue porte le romaji
// ("Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e"). Un premier essai qui
// ne comparait que le titre principal a créé 48 doublons sur 135 fiches.
function indexByTitles(rows) {
  const byKey = new Map();
  for (const r of rows) {
    for (const t of [r.title_romaji, r.title_english, r.title_native]) {
      const k = titleKey(t);
      if (!k) continue;
      if (!byKey.has(k)) byKey.set(k, []);
      const liste = byKey.get(k);
      if (!liste.includes(r)) liste.push(r);
    }
  }
  return byKey;
}

// Renvoie la fiche existante correspondante, `null` si l'œuvre est
// vraiment nouvelle, ou "AMBIGU" quand plusieurs fiches portent le même titre
// sans date pour les départager — dans ce cas on ne crée rien, car créer un
// doublon coûte plus cher que rater une fiche (un doublon se voit dans
// l'app et son identifiant ne peut plus jamais bouger).
const AMBIGU = "AMBIGU";

function findExisting(rec, byKey, annYear) {
  const cles = new Set();
  const ajoute = (t) => {
    const k = titleKey(t);
    if (k) cles.add(k);
  };
  ajoute(rec.mainTitle);
  ajoute(rec.name);
  // Seulement le titre principal de chaque langue, pas toutes les variantes :
  // ANN range dans les titres alternatifs des libelles d'oeuvres voisines, ce
  // qui reliait Kabaneri a un film coreen sans rapport lors d'un essai.
  ajoute((rec.titles?.EN || [])[0]);
  ajoute((rec.titles?.JA || [])[0]);

  const libres = [];
  for (const k of cles) {
    for (const r of byKey.get(k) || []) {
      // Une fiche déjà reliée à un AUTRE identifiant ANN n'est pas candidate.
      if (!r.ann_id && !libres.includes(r)) libres.push(r);
    }
  }
  if (libres.length === 0) return null;

  // Une fiche dont l'annee de debut differe de plus d'un an n'est pas la meme
  // oeuvre : une suite ou un remake porte souvent le meme titre.
  const anneeCompatible = (r) => {
    const y = r.start_date ? parseInt(r.start_date.slice(0, 4), 10) : null;
    if (!annYear || !y) return true;
    return Math.abs(y - annYear) <= 1;
  };
  const plausibles = libres.filter(anneeCompatible);
  if (plausibles.length === 0) return null;
  if (plausibles.length === 1) return plausibles[0];

  // Plusieurs fiches restent plausibles : on prefere ne rien faire plutot que
  // de relier la mauvaise.
  return AMBIGU;
}

async function syncAnime() {
  console.log("\n═══ Anime ═══");

  console.log("Récupération de la liste complète des anime ANN...");
  let items = parseAnnReport(await annFetch(`${REPORTS_URL}?id=155&type=anime&nlist=all`));
  console.log(`${items.length} anime listés par ANN.`);
  if (SYNC_LIMIT) items = items.slice(0, SYNC_LIMIT);

  const rows = await fetchAllRows(
    "catalog_anime",
    "id, ann_id, synopsis, cover_url, thumbnail_url, start_date, end_date, title_romaji, title_english, title_native, synonyms, genres, tags, type, status, episodes, season, season_year",
  );

  const byAnnId = new Map();
  for (const r of rows) if (r.ann_id) byAnnId.set(r.ann_id, r);
  const byKey = indexByTitles(rows);
  console.log(`${rows.length} fiches en base, dont ${byAnnId.size} déjà reliées à ANN.`);

  const ids = items.map((it) => it.ann_id);
  const batches = Math.ceil(ids.length / BATCH_SIZE);
  console.log(`${batches} requêtes de ${BATCH_SIZE} titres, ~${Math.round((batches * RATE_LIMIT_MS) / 1000)}s.`);

  let updated = 0;
  let created = 0;
  let linked = 0;
  let ambigus = 0;
  let failed = 0;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    try {
      const records = await fetchDetails("anime", chunk);
      const rowsById = new Map();
      let createdInBatch = 0;
      let linkedInBatch = 0;

      for (const rec of records) {
        const c = annCommonFields(rec);
        const annYear = c._annStart ? parseInt(c._annStart.slice(0, 4), 10) : null;
        let match = byAnnId.get(rec.ann_id);
        let estNouvelle = false;
        if (!match) {
          const trouve = findExisting(rec, byKey, annYear);
          if (trouve === AMBIGU) {
            ambigus++;
            continue;
          }
          match = trouve;
          if (match) linkedInBatch++;
          else estNouvelle = true;
        }
        // Sans titre exploitable, impossible de créer une fiche utilisable.
        if (!match && !(rec.mainTitle || rec.name)) continue;

        const id = match ? match.id : fromAnnId(rec.ann_id);
        // Deux fiches ANN peuvent retomber sur la même ligne : deux fois le
        // même id dans un upsert fait échouer toute la requête.
        if (!id || rowsById.has(id)) continue;
        if (estNouvelle) createdInBatch++;

        const start = prefer(match, "start_date", c._annStart);
        const end = prefer(match, "end_date", c._annEnd);
        const saison = seasonOf(start);

        // Jeu de clés strictement identique pour toutes les lignes du lot.
        rowsById.set(id, {
          id,
          ann_id: c.ann_id,
          titles: c.titles,
          staff: c.staff,
          characters: groupCast(rec.cast),
          external_links: c.external_links,
          opening_themes: rec.openingThemes,
          ending_themes: rec.endingThemes,
          copyright_notice: c.copyright_notice,
          ann_synced_at: c.ann_synced_at,
          ann_rating: c.ann_rating,
          ann_rating_votes: c.ann_rating_votes,
          ann_cover_url: c.ann_cover_url,
          ann_synopsis: c.ann_synopsis,
          ann_objectionable: c.ann_objectionable,
          ann_related: c.ann_related,

          title_romaji: prefer(match, "title_romaji", rec.mainTitle || rec.name),
          synopsis: prefer(match, "synopsis", c._annSynopsis),
          title_english: prefer(match, "title_english", c._annEnglish),
          title_native: prefer(match, "title_native", c._annNative),
          start_date: start,
          end_date: end,
          cover_url: prefer(match, "cover_url", c._annCover),
          thumbnail_url: prefer(match, "thumbnail_url", c._annCover),

          // Colonnes que MyAnimeList tient à jour : on ne les pose que si
          // elles sont vides, donc en pratique sur les fiches créées ici.
          type: prefer(match, "type", ANN_TYPE_MAP[rec.type] || null),
          status: prefer(match, "status", statusFromDates(start, end)),
          episodes: prefer(match, "episodes", rec.episodes),
          season: prefer(match, "season", saison.season),
          season_year: prefer(match, "season_year", saison.season_year),

          // Colonnes `not null` : jamais de null, tableau vide au pire.
          genres: normalizeGenres(prefer(match, "genres", rec.genres, [])),
          tags: [...new Set([...(match?.tags || []), ...rec.themes])],
          last_synced_at: new Date().toISOString(),
        });

        if (estNouvelle) {
          // Évite de recréer la même œuvre si elle revient dans un lot suivant
          // sous un autre de ses titres.
          const creee = {
            id,
            ann_id: rec.ann_id,
            start_date: c._annStart,
            title_romaji: rec.mainTitle || rec.name,
            title_english: c._annEnglish,
            title_native: c._annNative,
            synonyms: [],
          };
          for (const [k, liste] of indexByTitles([creee])) {
            if (!byKey.has(k)) byKey.set(k, []);
            byKey.get(k).push(...liste);
          }
        }
      }

      const lot = [...rowsById.values()];
      const done = await upsertInChunks("catalog_anime", lot);
      if (done > 0) {
        updated += done;
        created += createdInBatch;
        linked += linkedInBatch;
      } else if (lot.length > 0) {
        failed++;
      }
      const pct = Math.round(((i + chunk.length) / ids.length) * 100);
      process.stdout.write(
        `\r  ${pct}% — ${updated} fiches écrites (${created} créées, ${linked} rattachées), ${failed} lots en échec   `,
      );
    } catch (err) {
      failed++;
      console.error(`\n  Lot ${i}-${i + chunk.length} : ${err.message}`);
    }
    await sleep(RATE_LIMIT_MS);
  }
  console.log(
    `\nAnime terminé : ${updated} fiches écrites, dont ${created} créées et ${linked} rattachées à ANN. ` +
      `${ambigus} fiches ignorées (homonymes indiscernables), ${failed} lots en échec.`,
  );
}

/* ─── Phase manga ───────────────────────────────────────────────────── */

async function syncManga() {
  console.log("\n═══ Manga ═══");

  console.log("Récupération de la liste complète des manga ANN...");
  const reportXml = await annFetch(`${REPORTS_URL}?id=155&type=manga&nlist=all`);
  let items = parseAnnReport(reportXml);
  console.log(`${items.length} manga listés par ANN.`);
  if (SYNC_LIMIT) items = items.slice(0, SYNC_LIMIT);

  const existing = await fetchAllRows("catalog_manga", "id, ann_id, title_romaji, title_key, synopsis, cover_url, start_date, title_english, title_native, genres, authors");

  // Rapprochement par titre normalisé : contrairement à l'anime, ANN ne partage
  // aucun identifiant croisé côté manga, et anime-offline-database ne couvre
  // pas les manga. Le titre normalisé reste la seule clé commune fiable.
  const byKey = new Map();
  const byAnnId = new Map();
  const backfillKeys = [];
  for (const r of existing) {
    const k = r.title_key || titleKey(r.title_romaji);
    if (k && !byKey.has(k)) byKey.set(k, r);
    if (r.ann_id) byAnnId.set(r.ann_id, r);
    if (!r.title_key && k) backfillKeys.push({ id: r.id, title_key: k });
  }

  if (backfillKeys.length) {
    const done = await upsertInChunks("catalog_manga", backfillKeys);
    console.log(`Clés de titre calculées pour ${done} manga existants.`);
  }

  const ids = items.map((it) => it.ann_id);
  const batches = Math.ceil(ids.length / BATCH_SIZE);
  console.log(`${batches} requêtes de ${BATCH_SIZE} titres, ~${Math.round((batches * RATE_LIMIT_MS) / 1000)}s.`);

  let enriched = 0;
  let created = 0;
  let failed = 0;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    try {
      const records = await fetchDetails("manga", chunk);
      // Indexé par id : ANN publie plusieurs fiches pour une même œuvre
      // (rééditions, publications parallèles), qui se rabattent alors sur la
      // même ligne via le titre normalisé. Deux lignes de même id dans un seul
      // upsert font échouer toute la requête ("ON CONFLICT DO UPDATE command
      // cannot affect row a second time"), donc on ne garde que la première.
      const rowsById = new Map();
      let createdInBatch = 0;
      let enrichedInBatch = 0;

      for (const rec of records) {
        const c = annCommonFields(rec);
        const key = titleKey(rec.mainTitle || rec.name);
        const match = byAnnId.get(rec.ann_id) || (key ? byKey.get(key) : null);

        const id = match ? match.id : fromAnnId(rec.ann_id);
        if (!id || rowsById.has(id)) continue;

        // ANN range les auteurs dans le staff (Story, Art, Story & Art…).
        const annAuthors = [
          ...new Set(
            rec.staff.filter((s) => /story|art|creator|original/i.test(s.task)).map((s) => s.name),
          ),
        ];

        // Créations et mises à jour partagent le même jeu de clés : elles
        // partent dans le même lot, donc dans la même requête SQL.
        rowsById.set(id, {
          id,
          ann_id: c.ann_id,
          titles: c.titles,
          staff: c.staff,
          external_links: c.external_links,
          copyright_notice: c.copyright_notice,
          ann_synced_at: c.ann_synced_at,
          ann_rating: c.ann_rating,
          ann_rating_votes: c.ann_rating_votes,
          ann_cover_url: c.ann_cover_url,
          ann_synopsis: c.ann_synopsis,
          ann_objectionable: c.ann_objectionable,
          ann_related: c.ann_related,
          title_key: key,

          title_romaji: prefer(match, "title_romaji", rec.mainTitle || rec.name),
          title_english: prefer(match, "title_english", c._annEnglish),
          title_native: prefer(match, "title_native", c._annNative),
          synopsis: prefer(match, "synopsis", c._annSynopsis),
          cover_url: prefer(match, "cover_url", c._annCover),
          start_date: prefer(match, "start_date", c._annStart),

          // Colonnes `not null` : jamais de null, tableau vide au pire.
          genres: normalizeGenres(prefer(match, "genres", rec.genres, [])),
          authors: prefer(match, "authors", annAuthors, []),

          last_synced_at: new Date().toISOString(),
        });

        if (match) {
          enrichedInBatch++;
        } else {
          createdInBatch++;
          // Évite de recréer la même œuvre si elle réapparaît dans un lot suivant.
          if (key) byKey.set(key, { id });
        }
      }

      // Les compteurs ne bougent que si l'écriture a réellement abouti : sinon
      // le récapitulatif annonce des créations qui n'ont jamais eu lieu.
      const rows = [...rowsById.values()];
      const done = await upsertInChunks("catalog_manga", rows);
      if (done > 0) {
        created += createdInBatch;
        enriched += enrichedInBatch;
      } else if (rows.length > 0) {
        failed++;
      }
      const pct = Math.round(((i + chunk.length) / ids.length) * 100);
      process.stdout.write(`\r  ${pct}% — ${created} créés, ${enriched} enrichis, ${failed} lots en échec   `);
    } catch (err) {
      failed++;
      console.error(`\n  Lot ${i}-${i + chunk.length} : ${err.message}`);
    }
    await sleep(RATE_LIMIT_MS);
  }
  console.log(`\nManga terminé : ${created} créés, ${enriched} enrichis, ${failed} lots en échec.`);
}

/* ─── Point d'entrée ────────────────────────────────────────────────── */

async function main() {
  console.log("Source : Anime News Network Encyclopedia — données citées et liées dans l'app,");
  console.log("conformément à leurs conditions d'utilisation.\n");
  if (doAnime) await syncAnime();
  if (doManga) await syncManga();
  console.log("\nImport ANN terminé.");
}

main().catch((err) => {
  console.error("Échec de l'import ANN :", err);
  process.exit(1);
});
