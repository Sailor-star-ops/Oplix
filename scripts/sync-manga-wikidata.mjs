// Import du catalogue manga dans Supabase depuis Wikidata (CC0), sans
// MangaDex. Couverture volontairement plus restreinte que l'anime :
// seuls les manga notables présents sur Wikidata sont importés.
//
// Propriétés utilisées (vérifiées manuellement, pas de mémoire) :
//   P4087 = MyAnimeList manga ID     P8731 = AniList manga ID
//   P50   = auteur                   P123  = éditeur
//   P577  = date de publication
//
// Usage : node scripts/sync-manga-wikidata.mjs

import { upsertInChunks } from "./lib/supabaseAdmin.mjs";

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

async function main() {
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
  const rows = [...byId.values()];
  console.log(`${rows.length} manga exploitables (titre + ID présents) sur ${grouped.length} items Wikidata (${rawRows.length - rows.length} doublons d'ID fusionnés).`);

  const withAnilistId = rows.filter((r) => r.id < 900_000_000).length;
  console.log(`  dont ${withAnilistId} avec un croisement AniList, ${rows.length - withAnilistId} en ID interne Oplix.`);

  const done = await upsertInChunks("catalog_manga", rows);
  console.log(`${done}/${rows.length} lignes upsertées dans catalog_manga.`);
  console.log("Import manga terminé (synopsis et couvertures restent à compléter manuellement — pas de source ouverte trouvée pour ça).");
}

main().catch((err) => {
  console.error("Échec de l'import manga :", err);
  process.exit(1);
});
