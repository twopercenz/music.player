import "server-only";
import { createClient } from "@supabase/supabase-js";

// Server-only client using the secret key (sb_secret_..., replaces the old
// service_role JWT — see Supabase's 2026 API key migration). The app has no
// Supabase Auth / per-user accounts — access is already gated by the
// password-protected middleware, and all reads/writes go through our own API
// routes, so the client never talks to Supabase directly and this key never
// reaches the browser. We never need the publishable key for that reason.
export function getSupabaseServerClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY are not set");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
