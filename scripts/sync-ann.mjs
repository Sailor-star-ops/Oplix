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

async function syncAnime() {
  console.log("\n═══ Anime ═══");
  let rows = await fetchAllRows(
    "catalog_anime",
    "id, ann_id, synopsis, cover_url, thumbnail_url, start_date, end_date, title_english, title_native, genres, tags",
  );
  rows = rows.filter((r) => r.ann_id);
  if (SYNC_LIMIT) rows = rows.slice(0, SYNC_LIMIT);

  console.log(`${rows.length} anime portent un identifiant ANN.`);
  if (rows.length === 0) {
    console.log("Rien à faire — lance d'abord scripts/sync-anime.mjs pour récupérer les ann_id.");
    return;
  }

  const byAnnId = new Map(rows.map((r) => [r.ann_id, r]));
  const ids = [...byAnnId.keys()];
  const batches = Math.ceil(ids.length / BATCH_SIZE);
  console.log(`${batches} requêtes de ${BATCH_SIZE} titres, ~${Math.round((batches * RATE_LIMIT_MS) / 1000)}s.`);

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    try {
      const records = await fetchDetails("anime", chunk);
      const updates = [];

      for (const rec of records) {
        const existing = byAnnId.get(rec.ann_id);
        if (!existing) continue;
        const c = annCommonFields(rec);

        // Jeu de clés strictement identique pour toutes les lignes du lot.
        updates.push({
          id: existing.id,
          ann_id: c.ann_id,
          titles: c.titles,
          staff: c.staff,
          characters: groupCast(rec.cast),
          external_links: c.external_links,
          opening_themes: rec.openingThemes,
          ending_themes: rec.endingThemes,
          copyright_notice: c.copyright_notice,
          ann_synced_at: c.ann_synced_at,

          synopsis: prefer(existing, "synopsis", c._annSynopsis),
          title_english: prefer(existing, "title_english", c._annEnglish),
          title_native: prefer(existing, "title_native", c._annNative),
          start_date: prefer(existing, "start_date", c._annStart),
          end_date: prefer(existing, "end_date", c._annEnd),
          cover_url: prefer(existing, "cover_url", c._annCover),
          thumbnail_url: prefer(existing, "thumbnail_url", c._annCover),

          // Colonnes `not null` : jamais de null, tableau vide au pire.
          genres: prefer(existing, "genres", rec.genres, []),
          // Les thèmes ANN viennent s'ajouter aux tags du dataset, pas les remplacer.
          tags: [...new Set([...(existing.tags || []), ...rec.themes])],
        });
      }

      // upsert plutôt qu'update ligne à ligne : une requête par lot de 50.
      const done = await upsertInChunks("catalog_anime", updates);
      updated += done;
      const pct = Math.round(((i + chunk.length) / ids.length) * 100);
      process.stdout.write(`\r  ${pct}% — ${updated} anime enrichis, ${failed} lots en échec   `);
    } catch (err) {
      failed++;
      console.error(`\n  Lot ${i}-${i + chunk.length} : ${err.message}`);
    }
    await sleep(RATE_LIMIT_MS);
  }
  console.log(`\nAnime terminé : ${updated} fiches enrichies, ${failed} lots en échec.`);
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
          title_key: key,

          title_romaji: prefer(match, "title_romaji", rec.mainTitle || rec.name),
          title_english: prefer(match, "title_english", c._annEnglish),
          title_native: prefer(match, "title_native", c._annNative),
          synopsis: prefer(match, "synopsis", c._annSynopsis),
          cover_url: prefer(match, "cover_url", c._annCover),
          start_date: prefer(match, "start_date", c._annStart),

          // Colonnes `not null` : jamais de null, tableau vide au pire.
          genres: prefer(match, "genres", rec.genres, []),
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
