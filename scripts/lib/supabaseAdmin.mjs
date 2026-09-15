import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Variables manquantes : SUPABASE_URL et/ou SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Copie .env.example en .env et renseigne la clé service role (dashboard Supabase > Settings > API).",
  );
  process.exit(1);
}

// Clé service role : contourne la RLS, ne doit jamais être exposée au client
// (src/lib/supabase.js utilise volontairement la clé anon, pas celle-ci).
export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Supabase envoie un lot entier dans UNE seule requête, construite sur l'union
// des clés de tous les objets : une clé absente d'un objet y part à NULL, ce qui
// fait échouer tout le lot sur les colonnes `not null`. Le message d'erreur
// renvoyé par Postgres ("null value in column X") ne dit pas d'où vient le
// problème — d'où cette vérification explicite.
function assertUniformKeys(table, chunk, offset) {
  if (chunk.length < 2) return;
  const reference = Object.keys(chunk[0]).sort();
  const signature = reference.join(",");
  for (let i = 1; i < chunk.length; i++) {
    const keys = Object.keys(chunk[i]).sort();
    if (keys.join(",") !== signature) {
      const missing = reference.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !reference.includes(k));
      throw new Error(
        `upsert ${table} (lot à partir de la ligne ${offset}) : les objets n'ont pas les mêmes clés, ` +
          `le lot partirait avec des NULL involontaires.\n` +
          `  ligne ${offset + i} — manquantes : [${missing.join(", ") || "aucune"}] ` +
          `en trop : [${extra.join(", ") || "aucune"}]`,
      );
    }
  }
}

// Pagination Postgres : sans ORDER BY sur une clé unique, deux pages successives
// peuvent renvoyer la même ligne (et en omettre une autre). Si ces doublons
// atteignent un upsert, Postgres refuse tout le lot ("ON CONFLICT DO UPDATE
// command cannot affect row a second time"). Les requêtes paginées doivent
// trier sur l'id ; cette déduplication n'est que le filet de sécurité.
function dedupeById(table, rows) {
  const byId = new Map();
  for (const r of rows) byId.set(r.id, r); // la dernière occurrence l'emporte
  const dropped = rows.length - byId.size;
  if (dropped > 0) {
    console.warn(`upsert ${table} : ${dropped} doublon(s) d'id retiré(s) — pagination non triée en amont ?`);
  }
  return [...byId.values()];
}

export async function upsertInChunks(table, inputRows, chunkSize = 500) {
  const rows = dedupeById(table, inputRows);
  let done = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    assertUniformKeys(table, chunk, i);
    const { error } = await supabaseAdmin.from(table).upsert(chunk, { onConflict: "id" });
    if (error) {
      console.error(`Erreur upsert ${table} (lignes ${i}-${i + chunk.length}) :`, error.message);
    } else {
      done += chunk.length;
    }
  }
  return done;
}
