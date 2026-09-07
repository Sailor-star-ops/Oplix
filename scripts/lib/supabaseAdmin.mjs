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

export async function upsertInChunks(table, rows, chunkSize = 500) {
  let done = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabaseAdmin.from(table).upsert(chunk, { onConflict: "id" });
    if (error) {
      console.error(`Erreur upsert ${table} (lignes ${i}-${i + chunk.length}) :`, error.message);
    } else {
      done += chunk.length;
    }
  }
  return done;
}
