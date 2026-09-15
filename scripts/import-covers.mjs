// Rapatrie les jaquettes dans Supabase Storage, au lieu de les pointer chez
// des tiers (CDN de MyAnimeList, d'Anime-Planet, d'aniSearch, d'ANN…).
//
// Trois raisons, dans l'ordre :
//   1. JURIDIQUE — c'est la position la plus défendable. Une vignette
//      d'identification que tu héberges, attribuée et retirable sur demande,
//      vaut mieux qu'un hotlink permanent vers le CDN d'un tiers dont tu ne
//      respectes pas forcément les conditions.
//   2. FIABILITÉ — un CDN tiers peut throttler, changer ses URLs, ou être
//      filtré par le réseau de l'utilisateur. Là, tu maîtrises.
//   3. PERFORMANCE — un seul domaine, ton CDN, tes règles de cache.
//
// ⚠ QUOTA. Le catalogue compte ~61 000 jaquettes. À ~40 Ko l'unité cela
// représente ~2,4 Go, alors que l'offre gratuite Supabase plafonne à 1 Go.
// Le script est donc BORNÉ par défaut et traite les fiches les plus
// consultées d'abord : les 5 000 premières couvrent l'écrasante majorité de
// ce que voient réellement les utilisateurs, pour ~200 Mo. Monte la limite
// quand tu connaîtras ton offre et ton usage réel.
//
// Reprenable : une fiche déjà rapatriée (cover_origin_url renseigné) est
// ignorée. Arrête et relance quand tu veux.
//
// Usage :
//   node scripts/import-covers.mjs --dry-run        # estime le volume, n'écrit rien
//   node scripts/import-covers.mjs                  # 5000 fiches les plus consultées
//   node scripts/import-covers.mjs --limit 20000
//   node scripts/import-covers.mjs --manga --limit 3000

import { supabaseAdmin, sleep, upsertInChunks } from "./lib/supabaseAdmin.mjs";

const BUCKET = "covers";
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const doAnime = args.length === 0 || args.includes("--anime") || !args.includes("--manga");
const doManga = args.length === 0 || args.includes("--manga") || !args.includes("--anime");

function numArg(flag, fallback) {
  const i = args.indexOf(flag);
  if (i === -1 || !args[i + 1]) return fallback;
  const n = parseInt(args[i + 1], 10);
  return Number.isFinite(n) ? n : fallback;
}
const LIMIT = numArg("--limit", 5000);
const CONCURRENCY = numArg("--concurrency", 4);

const USER_AGENT = "Oplix-catalog-sync/1.0 (+https://oplix.app)";

async function ensureBucket() {
  const { data } = await supabaseAdmin.storage.listBuckets();
  if ((data || []).some((b) => b.name === BUCKET)) return;
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 2 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  });
  if (error) throw new Error(`création du bucket ${BUCKET} : ${error.message}`);
  console.log(`Bucket "${BUCKET}" créé (public, 2 Mo max par fichier).`);
}

function extensionOf(url) {
  const m = url.split("?")[0].match(/\.(jpe?g|png|webp)$/i);
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
}

const MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

async function pending(table) {
  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("id, cover_url")
      .not("cover_url", "is", null)
      .is("cover_origin_url", null)
      // Les fiches les plus vues d'abord : le quota profite à ce qui s'affiche.
      .order("trending_score", { ascending: false, nullsFirst: false })
      .order("members", { ascending: false, nullsFirst: false })
      .order("popularity", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true }) // départage unique, sinon doublons de pagination
      .range(from, from + page - 1);
    if (error) throw new Error(`${table} : ${error.message}`);
    rows.push(...data);
    if (data.length < page || rows.length >= LIMIT) break;
  }
  return rows.slice(0, LIMIT);
}

async function transferOne(table, row) {
  const ext = extensionOf(row.cover_url);
  const path = `${table === "catalog_anime" ? "anime" : "manga"}/${row.id}.${ext}`;

  const res = await fetch(row.cover_url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength === 0) throw new Error("réponse vide");

  if (DRY_RUN) return { bytes: buf.byteLength, update: null };

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buf, { contentType: MIME[ext] || "image/jpeg", upsert: true });
  if (error) throw new Error(`upload : ${error.message}`);

  const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  return {
    bytes: buf.byteLength,
    // cover_origin_url garde la provenance : c'est elle qui permet de citer la
    // source, et de refaire le transfert si besoin.
    update: { id: row.id, cover_url: pub.publicUrl, cover_origin_url: row.cover_url },
  };
}

async function processTable(table, label) {
  const rows = await pending(table);
  console.log(`\n═══ ${label} ═══\n${rows.length} jaquettes à rapatrier (plafond ${LIMIT}).`);
  if (!rows.length) return { bytes: 0, ok: 0 };

  let ok = 0;
  let failed = 0;
  let bytes = 0;
  const updates = [];

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map((r) => transferOne(table, r)));
    for (const [j, r] of results.entries()) {
      if (r.status === "fulfilled") {
        ok++;
        bytes += r.value.bytes;
        if (r.value.update) updates.push(r.value.update);
      } else {
        failed++;
        if (failed <= 5) console.error(`\n  ${batch[j].cover_url} : ${r.reason.message}`);
      }
    }
    if (updates.length >= 200) {
      await upsertInChunks(table, updates.splice(0, updates.length));
    }
    const pct = Math.round(((i + batch.length) / rows.length) * 100);
    process.stdout.write(
      `\r  ${pct}% — ${ok} transférées, ${failed} échecs, ${(bytes / 1024 / 1024).toFixed(1)} Mo   `,
    );
    await sleep(200); // politesse envers les CDN d'origine
  }
  if (updates.length) await upsertInChunks(table, updates);

  console.log(`\n${label} : ${ok} jaquettes, ${(bytes / 1024 / 1024).toFixed(1)} Mo, ${failed} échecs.`);
  return { bytes, ok };
}

async function main() {
  if (DRY_RUN) console.log("Mode estimation — rien n'est écrit ni téléversé.\n");
  else await ensureBucket();

  let total = 0;
  let count = 0;
  if (doAnime) {
    const r = await processTable("catalog_anime", "Anime");
    total += r.bytes;
    count += r.ok;
  }
  if (doManga) {
    const r = await processTable("catalog_manga", "Manga");
    total += r.bytes;
    count += r.ok;
  }

  const mo = total / 1024 / 1024;
  console.log(`\nTotal : ${count} jaquettes, ${mo.toFixed(1)} Mo.`);
  if (count > 0) {
    const moyenne = total / count / 1024;
    console.log(
      `Moyenne ${moyenne.toFixed(0)} Ko/image → le catalogue complet (~61 000) pèserait ` +
        `~${((moyenne * 61000) / 1024 / 1024).toFixed(2)} Go.`,
    );
    console.log("Rappel : l'offre gratuite Supabase plafonne à 1 Go de stockage.");
  }
}

main().catch((err) => {
  console.error("Échec du rapatriement :", err.message);
  process.exit(1);
});
