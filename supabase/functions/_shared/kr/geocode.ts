/**
 * NCP Maps Geocoding (네이버 클라우드 플랫폼 Maps, "Geocoding" API).
 *
 * GET https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=<address>
 *   x-ncp-apigw-api-key-id: <Client ID>
 *   x-ncp-apigw-api-key:    <Client Secret>
 * Response: {status: "OK", meta: {totalCount}, addresses: [{x: lng, y: lat, roadAddress, jibunAddress}]}
 *
 * Pure TypeScript, used by the Edge Functions.
 */
import { krRegion } from "./regions.ts";

export const NCP_GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** "11680|대치동|1027" -> "서울특별시 강남구 대치동 1027" (세종 has no separate 시군구 name). */
export function lotAddress(lawdCd: string, umdName: string, jibun: string): string {
  const r = krRegion(lawdCd);
  const head = r ? (r.name === r.sido ? r.sido : `${r.sido} ${r.name}`) : "";
  return [head, umdName, jibun].filter(Boolean).join(" ");
}

export function lotKey(lawdCd: string, umdName: string, jibun: string): string {
  return `${lawdCd}|${umdName}|${jibun}`;
}

export class GeocodeAuthError extends Error {
  override name = "GeocodeAuthError";
}

/** First result inside Korea, or null when the address is not found. Throws on auth/HTTP errors. */
export async function geocode(
  address: string,
  keys: { clientId: string; clientSecret: string },
  fetchFn: (url: string, init: RequestInit) => Promise<{ status: number; text(): Promise<string> }> = (u, i) => fetch(u, i),
): Promise<GeoPoint | null> {
  const res = await fetchFn(`${NCP_GEOCODE_URL}?query=${encodeURIComponent(address)}`, {
    headers: { "x-ncp-apigw-api-key-id": keys.clientId, "x-ncp-apigw-api-key": keys.clientSecret, Accept: "application/json" },
  });
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new GeocodeAuthError(`NCP Geocoding auth failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
  if (res.status !== 200) throw new Error(`NCP Geocoding HTTP ${res.status}: ${text.slice(0, 200)}`);
  const body = JSON.parse(text) as { status?: string; addresses?: Array<{ x?: string; y?: string }> };
  if (body.status && body.status !== "OK") throw new Error(`NCP Geocoding status ${body.status}`);
  for (const a of body.addresses ?? []) {
    const lng = Number(a.x);
    const lat = Number(a.y);
    if (lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132) return { lat, lng };
  }
  return null;
}
