// HTTP helpers shared by every Edge Function. No Deno globals here so the
// module can also be imported by unit tests running under Node/vitest.

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

/** An error with an HTTP status and a stable, client-facing code. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string = defaultCode(status),
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function defaultCode(status: number): string {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 405:
      return "METHOD_NOT_ALLOWED";
    case 409:
      return "CONFLICT";
    case 413:
      return "PAYLOAD_TOO_LARGE";
    case 422:
      return "UNPROCESSABLE";
    case 429:
      return "RATE_LIMITED";
    case 502:
      return "UPSTREAM_ERROR";
    case 503:
      return "NOT_CONFIGURED";
    default:
      return status >= 500 ? "INTERNAL" : "ERROR";
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

export function errorResponse(status: number, error: string, code?: string, headers: Record<string, string> = {}): Response {
  return json({ error, code: code ?? defaultCode(status) }, status, headers);
}

/** Parses a JSON object body; anything else is a 400. */
export async function readJsonObject(req: Request, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "request body too large");
  if (!text.trim()) throw new HttpError(400, "request body must be a JSON object");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "request body is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function optionalString(body: Record<string, unknown>, key: string, max = 500): string | undefined {
  const v = body[key];
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || v.length > max) throw new HttpError(400, `${key} must be a string of at most ${max} characters`);
  return v;
}

export function requiredString(body: Record<string, unknown>, key: string, max = 500): string {
  const v = optionalString(body, key, max);
  if (v === undefined) throw new HttpError(400, `${key} is required`);
  return v;
}

export function optionalUuid(body: Record<string, unknown>, key: string): string | undefined {
  const v = optionalString(body, key, 36);
  if (v !== undefined && !UUID_RE.test(v)) throw new HttpError(400, `${key} must be a UUID`);
  return v;
}

export function requiredUuid(body: Record<string, unknown>, key: string): string {
  const v = optionalUuid(body, key);
  if (v === undefined) throw new HttpError(400, `${key} is required`);
  return v;
}

/**
 * Wraps a POST handler: CORS preflight, method check, and conversion of
 * thrown errors into `{error, code}` JSON. Unexpected errors are logged and
 * reported as a generic 500 so internals never leak to clients.
 */
export function handler(fn: (req: Request) => Promise<Response>, opts: { methods?: string[] } = {}) {
  const methods = opts.methods ?? ["POST"];
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
    if (!methods.includes(req.method)) return errorResponse(405, "method not allowed");
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err.status, err.message, err.code);
      console.error("unhandled error", err);
      return errorResponse(500, "internal error", "INTERNAL");
    }
  };
}

/** Constant-time string comparison (length is not secret). */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function bearerToken(req: Request): string | null {
  const h = req.headers.get("Authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1]!.trim() : null;
}

/** Best-effort client IP (Supabase puts the caller first in x-forwarded-for). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? req.headers.get("cf-connecting-ip") ?? "unknown";
}

/** Claims of a JWT, without checking its signature (null when it is not a JWT). */
export function jwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0)));
    const claims = JSON.parse(json) as unknown;
    return claims && typeof claims === "object" && !Array.isArray(claims) ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Whether `token` is this project's service-role key. Equal to the runtime's
 * SUPABASE_SERVICE_ROLE_KEY, or a JWT with role service_role for this project
 * (the runtime may hold the newer sb_secret_ key while callers such as pg_cron
 * send the legacy JWT).
 *
 * The claim check does NOT verify the signature: it is only safe in functions
 * deployed with verify_jwt = true, where the gateway has already verified it.
 */
export function isServiceRoleToken(token: string | null, env: { serviceRoleKey?: string; supabaseUrl?: string }, now = Date.now()): boolean {
  if (!token) return false;
  if (env.serviceRoleKey && timingSafeEqual(token, env.serviceRoleKey)) return true;
  const claims = jwtClaims(token);
  if (!claims || claims.role !== "service_role") return false;
  let ref: string | undefined;
  try {
    ref = env.supabaseUrl ? new URL(env.supabaseUrl).hostname.split(".")[0] : undefined;
  } catch {
    ref = undefined;
  }
  if (!ref || claims.ref !== ref) return false;
  return typeof claims.exp !== "number" || claims.exp * 1000 > now;
}
