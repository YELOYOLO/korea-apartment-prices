import { describe, expect, it } from "vitest";
import { geocode, lotAddress, NCP_GEOCODE_URL } from "../supabase/functions/_shared/kr/geocode.ts";
import { syncKrGeo, type KrGeoDb } from "../supabase/functions/_shared/krGeo.ts";

const keys = { clientId: "id", clientSecret: "secret" };
const reply = (status: number, body: unknown) => async () => ({ status, text: async () => JSON.stringify(body) });

describe("lotAddress", () => {
  it("prefixes the 시도 and 시군구 from the LAWD_CD", () => {
    expect(lotAddress("11680", "대치동", "1027")).toBe("서울특별시 강남구 대치동 1027");
    expect(lotAddress("41135", "정자동", "1")).toBe("경기도 성남시 분당구 정자동 1");
    expect(lotAddress("36110", "보람동", "700")).toBe("세종특별자치시 보람동 700");
  });
});

describe("geocode", () => {
  it("sends the NCP key headers and reads x/y", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const p = await geocode("서울특별시 강남구 대치동 1027", keys, async (url, init) => {
      seen = { url, init };
      return { status: 200, text: async () => JSON.stringify({ status: "OK", addresses: [{ x: "127.0628", y: "37.4946" }] }) };
    });
    expect(p).toEqual({ lat: 37.4946, lng: 127.0628 });
    expect(seen!.url.startsWith(`${NCP_GEOCODE_URL}?query=`)).toBe(true);
    expect((seen!.init.headers as Record<string, string>)["x-ncp-apigw-api-key-id"]).toBe("id");
  });

  it("returns null when nothing is found and throws on auth errors", async () => {
    expect(await geocode("x", keys, reply(200, { status: "OK", addresses: [] }))).toBeNull();
    await expect(geocode("x", keys, reply(401, { error: "Unauthorized" }))).rejects.toMatchObject({ name: "GeocodeAuthError" });
  });
});

function fakeDb(todo: object[]) {
  const upserts: object[][] = [];
  const db: KrGeoDb = {
    rpc: async () => ({ data: todo, error: null }),
    from: () => ({ upsert: async (rows) => (upserts.push(rows), { error: null }) }),
  };
  return { db, upserts };
}

describe("syncKrGeo", () => {
  const todo = [
    { key: "11680|대치동|1027", lawd_cd: "11680", umd_name: "대치동", jibun: "1027", kind: "flagship" },
    { key: "11680|대치동|9999", lawd_cd: "11680", umd_name: "대치동", jibun: "9999", kind: "auction" },
  ];

  it("is a no-op without keys", async () => {
    expect(await syncKrGeo(fakeDb(todo).db, null)).toEqual({ configured: false, geocoded: 0 });
  });

  it("stores found and not-found lots", async () => {
    const { db, upserts } = fakeDb(todo);
    const r = await syncKrGeo(db, async (a) => (a.endsWith("1027") ? { lat: 37.49, lng: 127.06 } : null));
    expect(r).toMatchObject({ configured: true, geocoded: 2, found: 1, failed: [] });
    expect(upserts[0]).toMatchObject([
      { key: "11680|대치동|1027", status: "ok", lat: 37.49, address: "서울특별시 강남구 대치동 1027" },
      { key: "11680|대치동|9999", status: "not_found", lat: null },
    ]);
  });

  it("stops on an auth error without writing", async () => {
    const { db, upserts } = fakeDb(todo);
    const err = Object.assign(new Error("auth failed"), { name: "GeocodeAuthError" });
    await expect(syncKrGeo(db, async () => Promise.reject(err))).rejects.toThrow("auth failed");
    expect(upserts).toEqual([]);
  });
});
