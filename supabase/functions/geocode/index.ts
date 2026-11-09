// geocode: map coordinates for the 지도 page (kr_geo), called hourly by pg_cron.
// Service role only (verify_jwt = true). Keys: NAVER_MAP_CLIENT_ID / NAVER_MAP_CLIENT_SECRET
// (NCP Maps application with Geocoding). Without them it reports configured: false.
import { handler, HttpError, json } from "../_shared/http.ts";
import { geocode } from "../_shared/kr/geocode.ts";
import { syncKrGeo, type KrGeoDb } from "../_shared/krGeo.ts";
import { env, requireServiceRole, serviceClient } from "../_shared/supabase.ts";

Deno.serve(
  handler(async (req) => {
    requireServiceRole(req);
    const clientId = env("NAVER_MAP_CLIENT_ID");
    const clientSecret = env("NAVER_MAP_CLIENT_SECRET");
    const geo = clientId && clientSecret ? (address: string) => geocode(address, { clientId, clientSecret }) : null;
    try {
      return json({ job: "geocode", result: await syncKrGeo(serviceClient() as unknown as KrGeoDb, geo) });
    } catch (err) {
      console.error("geocode failed", err);
      throw new HttpError(500, `geocode failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500), "SYNC_FAILED");
    }
  }),
);
