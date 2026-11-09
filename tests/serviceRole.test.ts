import { describe, expect, it } from "vitest";
import { isServiceRoleToken, jwtClaims } from "../supabase/functions/_shared/http.ts";

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims: Record<string, unknown>) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.sig`;
const env = { serviceRoleKey: "sb_secret_runtime", supabaseUrl: "https://abcdref.supabase.co" };
const NOW = Date.parse("2026-11-09T00:00:00Z");

describe("isServiceRoleToken", () => {
  it("accepts the runtime key itself", () => {
    expect(isServiceRoleToken("sb_secret_runtime", env, NOW)).toBe(true);
  });

  it("accepts a legacy service_role JWT for this project", () => {
    expect(isServiceRoleToken(jwt({ iss: "supabase", ref: "abcdref", role: "service_role", exp: NOW / 1000 + 3600 }), env, NOW)).toBe(true);
    expect(isServiceRoleToken(jwt({ ref: "abcdref", role: "service_role" }), env, NOW)).toBe(true);
  });

  it("rejects anon keys, other projects, expired tokens and junk", () => {
    expect(isServiceRoleToken(jwt({ ref: "abcdref", role: "anon" }), env, NOW)).toBe(false);
    expect(isServiceRoleToken(jwt({ ref: "otherref", role: "service_role" }), env, NOW)).toBe(false);
    expect(isServiceRoleToken(jwt({ ref: "abcdref", role: "service_role", exp: NOW / 1000 - 1 }), env, NOW)).toBe(false);
    expect(isServiceRoleToken(jwt({ ref: "abcdref", role: "service_role" }), { serviceRoleKey: "x" }, NOW)).toBe(false);
    expect(isServiceRoleToken("not-a-jwt", env, NOW)).toBe(false);
    expect(isServiceRoleToken(null, env, NOW)).toBe(false);
    expect(jwtClaims("a.!!!.c")).toBeNull();
  });
});
