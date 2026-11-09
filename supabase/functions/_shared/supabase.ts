// Supabase client and caller check for the Edge Functions (Deno only).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";
import { bearerToken, HttpError, isServiceRoleToken } from "./http.ts";

export type { SupabaseClient };

export function env(name: string): string | undefined {
  const v = Deno.env.get(name);
  return v === undefined || v.trim() === "" ? undefined : v.trim();
}

export function requireEnv(name: string): string {
  const v = env(name);
  if (!v) throw new HttpError(500, `server misconfigured: ${name} is not set`, "INTERNAL");
  return v;
}

/** Service-role client: bypasses RLS. Use only after authorizing the caller. */
export function serviceClient(): SupabaseClient {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Only the service role (pg_cron) may call the sync. Needs verify_jwt = true: see isServiceRoleToken. */
export function requireServiceRole(req: Request): void {
  if (!isServiceRoleToken(bearerToken(req), { serviceRoleKey: env("SUPABASE_SERVICE_ROLE_KEY"), supabaseUrl: env("SUPABASE_URL") })) {
    throw new HttpError(401, "service role only", "UNAUTHORIZED");
  }
}
