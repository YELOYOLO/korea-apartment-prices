// AI 검색 에이전트: a spoken or typed request -> map search filters + a short reply.
// The model (Claude, structured output) turns the request into filters, given the
// filters on screen so follow-ups ("더 싼 걸로", "목록으로") work. Its JSON is
// validated with normalizeFilters; when the model is not configured, over its usage
// limit or fails, the rule-based parser answers instead.
// No Deno globals and no SDK import (the model call is passed in), so vitest can load it.
import { KR_REGIONS, KR_SIDO } from "./kr/regions.ts";
import { describeFilters, NL_AREAS, NL_KINDS, NL_SORTS, NL_UNSUPPORTED, normalizeFilters, ruleParse, type NlFilters } from "./kr/nlquery.ts";

const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });

/** Structured-output schema (no numeric/length constraints: normalizeFilters enforces them). */
export const AI_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sido", "sgg", "umd", "apt", "types", "priceMin", "priceMax", "discountMin", "area", "built", "days", "volumeMin", "belowAvg", "sort", "view", "reply"],
  properties: {
    sido: nullable({ type: "string", enum: [...KR_SIDO] }),
    sgg: nullable({ type: "string" }),
    umd: nullable({ type: "string" }),
    apt: { type: "string" },
    types: { type: "array", items: { type: "string", enum: [...NL_KINDS] } },
    priceMin: nullable({ type: "integer" }),
    priceMax: nullable({ type: "integer" }),
    discountMin: nullable({ type: "integer" }),
    area: { type: "string", enum: [...NL_AREAS] },
    built: nullable({ type: "integer" }),
    days: { type: "integer" },
    volumeMin: nullable({ type: "integer" }),
    belowAvg: { type: "boolean" },
    sort: { type: "string", enum: [...NL_SORTS] },
    view: { type: "string", enum: ["map", "list"] },
    reply: { type: "string" },
  },
} as const;

export const AI_SYSTEM = `You turn a Korean home buyer's spoken or typed request into search filters for Mydream, a site that finds apartments in Korea priced below market. You get the filters currently on screen and the request; answer with the complete filter set to apply.

The site searches three kinds of items (types):
- flagship ("대장 급매"): recent reported deals in each 시군구's top complexes that closed below the complex's market value
- lowdeal ("저가 실거래"): the same for every other complex
- auction ("공매"): current Onbid public auctions, priced by their minimum bid
An empty types array means all three. "급매" alone means flagship and lowdeal; "대장" means flagship; "공매"/"경매" means auction.

Fields:
- sido: one of the listed 시도, or null. sgg: a 5-digit code from the region list below, or null for the whole 시도. Pick the 시군구 the person means; when a name such as 중구 exists in several 시도, use the 시도 they said or the one on screen. umd: a 법정동/읍/면 name inside that 시군구 exactly as spoken (e.g. "대치동"), or null; only with an sgg.
- apt: a complex name the person said (e.g. "래미안"), else "".
- priceMin / priceMax: in 만원 (15억 = 150000, 8억5천 = 85000), or null. "15억 이하" sets priceMax; "10억대" is 100000-109999; "8억 정도" is about ±10%.
- discountMin: minimum percent below market (5-40), or null for no limit. Keep the current value unless the request mentions it.
- area (전용면적): "s" up to 59㎡ (about 24평 or less), "m" 59-84㎡ (국평, 25-34평), "l" 84-114㎡, "xl" above 114㎡, "all".
- built: built within N years (5, 10, 20, 30) or null; 신축 = 5, 준신축 = 10.
- days: how far back deals are searched: 30, 90, 180 or 365.
- volumeMin: the complex's deals in the last year at least N (3, 5, 10, 20), or null. belowAvg: true to keep only items whose price per 평 is below the 법정동 median.
- sort: "discount" (largest discount first), "price" (cheapest first), "newest", "volume" (most traded complexes first). view: "map" or "list".
- reply: one or two short sentences in Korean, polite 해요체, saying what you applied. If the request asks for something the site cannot filter yet (역세권, 전세가율, 갭투자금, 세대수), say so briefly. Never invent listings, prices or counts, and give no investment advice.

Start from the current filters and change only what the request asks for, unless it asks to start over (then start from: 서울특별시, all types, discount 15, area all, days 90, sort discount).

Region list (code 시도 시군구):
${KR_REGIONS.map((r) => `${r.code} ${r.sido} ${r.name}`).join("\n")}`;

export interface AiSearchAnswer {
  filters: NlFilters;
  reply: string;
  /** "ai": the model answered; "rules": the keyword parser did. */
  mode: "ai" | "rules";
  summary: string;
  /** Why the AI was not used, when it was not. */
  note?: "not_configured" | "limited" | "failed";
}

export interface AiSearchDeps {
  /** Returns the model's JSON text, or null when it declined. Null deps = not configured. */
  ask: ((system: string, user: string) => Promise<string | null>) | null;
  /** Counts the request against the usage limits; false = over a limit. */
  allowed: () => Promise<boolean>;
}

function ruleReply(understood: string[], unsupported: string[]): string {
  const head = understood.length ? `${understood.join(", ")} 조건으로 찾았어요.` : "말씀하신 조건을 정확히 알아듣지 못해 지금 조건을 유지했어요. 지역, 가격, 면적, 할인율을 말씀해 주세요.";
  return unsupported.length ? `${head} ${unsupported.join(", ")} 조건은 아직 준비 중이에요.` : head;
}

export async function answerSearch(query: string, current: NlFilters, deps: AiSearchDeps): Promise<AiSearchAnswer> {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 300);
  const rules = (note?: AiSearchAnswer["note"]): AiSearchAnswer => {
    const r = ruleParse(q, current);
    return { filters: r.filters, reply: ruleReply(r.understood, r.unsupported), mode: "rules", summary: describeFilters(r.filters), note };
  };
  if (!deps.ask) return rules("not_configured");
  if (!(await deps.allowed())) return rules("limited");
  try {
    const text = await deps.ask(AI_SYSTEM, JSON.stringify({ current, request: q }));
    if (!text) return rules("failed");
    const raw = JSON.parse(text) as Record<string, unknown>;
    const filters = normalizeFilters(raw, current);
    let reply = typeof raw.reply === "string" ? raw.reply.trim().slice(0, 300) : "";
    const unsupported = NL_UNSUPPORTED.filter((u) => u.re.test(q)).map((u) => u.label);
    if (!reply) reply = ruleReply([], unsupported);
    return { filters, reply, mode: "ai", summary: describeFilters(filters) };
  } catch {
    return rules("failed");
  }
}
