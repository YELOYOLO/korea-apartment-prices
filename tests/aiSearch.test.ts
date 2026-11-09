import { describe, expect, it } from "vitest";
import { AI_SCHEMA, AI_SYSTEM, answerSearch } from "../supabase/functions/_shared/aiSearch.ts";
import { NL_DEFAULTS } from "../supabase/functions/_shared/kr/nlquery.ts";

const allowed = async () => true;

describe("answerSearch", () => {
  it("uses the rule parser when the model is not configured", async () => {
    const a = await answerSearch("강남구 공매", NL_DEFAULTS, { ask: null, allowed });
    expect(a).toMatchObject({ mode: "rules", note: "not_configured" });
    expect(a.filters).toMatchObject({ sgg: "11680", types: ["auction"] });
    expect(a.reply).toContain("강남구");
  });

  it("uses the rule parser when over the usage limit, without calling the model", async () => {
    let called = false;
    const a = await answerSearch("부산 해운대구", NL_DEFAULTS, { ask: async () => ((called = true), "{}"), allowed: async () => false });
    expect(a).toMatchObject({ mode: "rules", note: "limited" });
    expect(called).toBe(false);
  });

  it("validates the model's JSON and keeps its reply", async () => {
    let seen: { system: string; user: string } | null = null;
    const a = await answerSearch("판교 쪽 국평 12억 이하로, 더 많이 싼 거", { ...NL_DEFAULTS, discountMin: 15 }, {
      allowed,
      ask: async (system, user) => {
        seen = { system, user };
        return JSON.stringify({
          sido: "경기도", sgg: "41135", umd: "삼평동", apt: "", types: [], priceMin: null, priceMax: 120000, discountMin: 22,
          area: "m", built: null, days: 90, volumeMin: null, belowAvg: false, sort: "discount", view: "map",
          reply: "분당구 삼평동, 12억 이하 국평으로 찾아볼게요.",
        });
      },
    });
    expect(a.mode).toBe("ai");
    expect(a.filters).toMatchObject({ sido: "경기도", sgg: "41135", umd: "삼평동", priceMax: 120_000, discountMin: 20, area: "m" });
    expect(a.reply).toBe("분당구 삼평동, 12억 이하 국평으로 찾아볼게요.");
    expect(JSON.parse(seen!.user)).toMatchObject({ request: "판교 쪽 국평 12억 이하로, 더 많이 싼 거", current: { discountMin: 15 } });
  });

  it("falls back to the rules when the model declines or returns bad JSON", async () => {
    expect(await answerSearch("강남구", NL_DEFAULTS, { allowed, ask: async () => null })).toMatchObject({ mode: "rules", note: "failed" });
    expect(await answerSearch("강남구", NL_DEFAULTS, { allowed, ask: async () => "not json" })).toMatchObject({ mode: "rules", note: "failed" });
    expect(await answerSearch("강남구", NL_DEFAULTS, { allowed, ask: async () => Promise.reject(new Error("timeout")) })).toMatchObject({ mode: "rules" });
  });
});

describe("AI prompt and schema", () => {
  it("lists every region and requires every field", () => {
    expect(AI_SYSTEM).toContain("11680 서울특별시 강남구");
    expect(AI_SYSTEM).toContain("41135 경기도 성남시 분당구");
    expect(AI_SCHEMA.required).toHaveLength(Object.keys(AI_SCHEMA.properties).length);
  });
});
