// ai-search: the map's voice/text search agent. POST {query, current} -> {filters, reply, mode, summary}.
// Any visitor may call it (verify_jwt = true with the site's anon key). Claude turns the
// request into filters (structured output); each call is counted per client and per site
// (kr_ai_take, 0006) and, without ANTHROPIC_API_KEY or over a limit, the rule-based parser
// answers instead.
import Anthropic from "npm:@anthropic-ai/sdk@1.1.0";
import { AI_SCHEMA, answerSearch } from "../_shared/aiSearch.ts";
import { clientIp, handler, json, readJsonObject, requiredString } from "../_shared/http.ts";
import { NL_DEFAULTS, normalizeFilters } from "../_shared/kr/nlquery.ts";
import { env, serviceClient } from "../_shared/supabase.ts";

const MODEL = "claude-opus-5-5";
const PER_CLIENT_PER_HOUR = 30;
const PER_SITE_PER_DAY = 1000;

async function clientKey(req: Request): Promise<string> {
  const data = new TextEncoder().encode(`${env("SUPABASE_URL") ?? ""}|${clientIp(req)}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const apiKey = env("ANTHROPIC_API_KEY");
const anthropic = apiKey ? new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 }) : null;

async function ask(system: string, user: string): Promise<string | null> {
  const params = {
    model: MODEL,
    max_tokens: 4096,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    output_config: { effort: "low", format: { type: "json_schema", schema: AI_SCHEMA } },
    messages: [{ role: "user", content: user }],
  };
  // deno-lint-ignore no-explicit-any
  const res = await anthropic!.beta.messages.create(params as any);
  if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") {
    console.warn("ai-search: no answer", res.stop_reason);
    return null;
  }
  for (const block of res.content) if (block.type === "text") return block.text;
  return null;
}

Deno.serve(
  handler(async (req) => {
    const body = await readJsonObject(req, 16 * 1024);
    const query = requiredString(body, "query", 300);
    const current = normalizeFilters(body.current ?? {}, NL_DEFAULTS);
    const key = await clientKey(req);
    const answer = await answerSearch(query, current, {
      ask: anthropic
        ? async (system, user) => {
            try {
              return await ask(system, user);
            } catch (err) {
              console.error("ai-search: model call failed", err instanceof Error ? err.message : err);
              throw err;
            }
          }
        : null,
      allowed: async () => {
        const { data, error } = await serviceClient().rpc("kr_ai_take", { p_client: key, p_per_hour: PER_CLIENT_PER_HOUR, p_per_day: PER_SITE_PER_DAY });
        if (error) {
          console.error("ai-search: kr_ai_take failed", error.message);
          return false;
        }
        return data === true;
      },
    });
    return json(answer);
  }),
);
