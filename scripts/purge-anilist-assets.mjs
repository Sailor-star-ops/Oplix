// Retire du catalogue toute image hébergée par AniList.
//
// Pourquoi : AniList a explicitement refusé l'accès à ses données à Oplix en
// tant que tracker concurrent. Continuer à pointer vers son CDN (s4.anilist.co)
// pour afficher des jaquettes revient à consommer sa bande passante et ses
// contenus après un refus écrit — c'est le point le plus attaquable du projet.
// Ces entrées repartent sans visuel ; scripts/sync-ann.mjs les repeuple ensuite
// depuis le CDN d'Anime News Network, dont les conditions l'autorisent.
//
// Le script est idempotent : une seconde exécution ne trouve plus rien.
//
// Usage : node scripts/purge-anilist-assets.mjs [--dry-run]

import { supabaseAdmin, upsertInChunks } from "./lib/supabaseAdmin.mjs";

const DRY_RUN = process.argv.includes("--dry-run");

const TARGETS = [
  { table: "catalog_anime", fields: ["cover_url", "thumbnail_url"] },
  { table: "catalog_manga", fields: ["cover_url"] },
];

function isAnilistHosted(url) {
  if (!url) return false;
  try {
    return new URL(url).hostname.endsWith("anilist.co");
  } catch {
    return false;
  }
}

async function fetchAll(table, cols) {
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

async function main() {
  if (DRY_RUN) console.log("Mode simulation — aucune écriture.\n");

  for (const { table, fields } of TARGETS) {
    const rows = await fetchAll(table, ["id", ...fields].join(", "));
    const updates = [];

    for (const row of rows) {
      const patch = {};
      for (const f of fields) {
        if (isAnilistHosted(row[f])) patch[f] = null;
      }
      if (Object.keys(patch).length > 0) updates.push({ id: row.id, ...patch });
    }

    const urlCount = updates.reduce((n, u) => n + Object.keys(u).length - 1, 0);
    console.log(`${table} : ${updates.length} lignes concernées, ${urlCount} URLs AniList à retirer.`);

    if (updates.length > 0 && !DRY_RUN) {
      const done = await upsertInChunks(table, updates);
      console.log(`  ${done} lignes nettoyées.`);
    }
  }

  console.log(
    DRY_RUN
      ? "\nSimulation terminée."
      : "\nPurge terminée. Lance scripts/sync-ann.mjs pour repeupler les visuels manquants depuis Anime News Network.",
  );
}

main().catch((err) => {
  console.error("Échec de la purge :", err);
  process.exit(1);
});
