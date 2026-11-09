// geocode function: map coordinates for the lots shown on the 지도 page (kr_geo_todo, 0003).
// Up to `limit` addresses per run through NCP Geocoding; each result (or not_found)
// is stored in kr_geo so it is looked up once. Needs NAVER_MAP_CLIENT_ID and
// NAVER_MAP_CLIENT_SECRET; without them: configured: false.
// No Deno globals and no value imports of fetch code (the geocoder is passed in).
import type { GeoPoint } from "./kr/geocode.ts";
import { lotAddress } from "./kr/geocode.ts";

interface DbError {
  message: string;
}
export interface KrGeoDb {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError | null }>;
  from(table: string): { upsert(rows: object[], options: { onConflict: string }): PromiseLike<{ error: DbError | null }> };
}

type Todo = { key: string; lawd_cd: string; umd_name: string; jibun: string; kind: string };

export async function syncKrGeo(
  db: KrGeoDb,
  geocodeFn: ((address: string) => Promise<GeoPoint | null>) | null,
  opts: { limit?: number; timeBudgetMs?: number; clock?: () => number } = {},
) {
  if (!geocodeFn) return { configured: false, geocoded: 0 };
  const clock = opts.clock ?? (() => Date.now());
  const deadline = clock() + (opts.timeBudgetMs ?? 100_000);
  const { data, error } = await db.rpc("kr_geo_todo", { p_limit: opts.limit ?? 300 });
  if (error) throw new Error(`kr_geo_todo failed: ${error.message}`);
  const todo = (data ?? []) as Todo[];
  const rows: Array<{ key: string; address: string; lat: number | null; lng: number | null; status: string; geocoded_at: string }> = [];
  let found = 0;
  const failed: string[] = [];
  for (const t of todo) {
    if (clock() > deadline) break;
    const address = lotAddress(t.lawd_cd, t.umd_name, t.jibun);
    try {
      const p = await geocodeFn(address);
      if (p) found++;
      rows.push({ key: t.key, address, lat: p?.lat ?? null, lng: p?.lng ?? null, status: p ? "ok" : "not_found", geocoded_at: new Date(clock()).toISOString() });
    } catch (err) {
      if (err instanceof Error && err.name === "GeocodeAuthError") throw err;
      failed.push(t.key);
      if (failed.length >= 5) break;
    }
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error: upErr } = await db.from("kr_geo").upsert(rows.slice(i, i + 500), { onConflict: "key" });
    if (upErr) throw new Error(`kr_geo upsert failed: ${upErr.message}`);
  }
  return { configured: true, todo: todo.length, geocoded: rows.length, found, failed };
}
