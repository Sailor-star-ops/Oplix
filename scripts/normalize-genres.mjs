// Passe unique : réécrit les genres déjà en base dans la casse de référence
// (voir scripts/lib/genres.mjs). À relancer sans risque, elle est idempotente.
//
// Usage :
//   node scripts/normalize-genres.mjs --dry-run   # compte sans rien écrire
//   node scripts/normalize-genres.mjs

import { supabaseAdmin, upsertInChunks } from "./lib/supabaseAdmin.mjs";
import { normalizeGenres } from "./lib/genres.mjs";

const DRY = process.argv.includes("--dry-run");

async function fetchAll(table) {
  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    // Tri sur l'id : sans clé unique, la pagination répète et omet des lignes.
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("id, genres")
      .order("id")
      .range(from, from + page - 1);
    if (error) throw new Error(`${table} : ${error.message}`);
    rows.push(...data);
    if (data.length < page) break;
  }
  return rows;
}

async function run(table) {
  const rows = await fetchAll(table);
  const changed = [];
  for (const row of rows) {
    const next = normalizeGenres(row.genres);
    const before = row.genres || [];
    if (next.length !== before.length || next.some((g, i) => g !== before[i])) {
      changed.push({ id: row.id, genres: next });
    }
  }
  console.log(`${table} : ${changed.length} fiches à corriger sur ${rows.length}.`);
  if (!changed.length || DRY) return;
  const done = await upsertInChunks(table, changed);
  console.log(`  ${done} fiches réécrites.`);
}

await run("catalog_anime");
await run("catalog_manga");
console.log(DRY ? "\nSimulation terminée, rien n'a été écrit." : "\nNormalisation terminée.");
