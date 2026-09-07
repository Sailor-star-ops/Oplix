import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://okocdleedpysinvsxfim.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_CWZH4lCy2YrbQvebboKdFA_KP9H0Bet";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
