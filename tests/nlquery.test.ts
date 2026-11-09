import { describe, expect, it } from "vitest";
import { describeFilters, NL_DEFAULTS, normalizeFilters, ruleParse } from "../supabase/functions/_shared/kr/nlquery.ts";

describe("ruleParse", () => {
  it("reads region, price, area, discount and type", () => {
    const r = ruleParse("강남구 15억 이하 국평 20% 이상 싼 공매");
    expect(r.filters).toMatchObject({ sido: "서울특별시", sgg: "11680", priceMax: 150_000, priceMin: null, area: "m", discountMin: 20, types: ["auction"] });
  });

  it("uses the 시도 to pick among same-named 구", () => {
    expect(ruleParse("부산 해운대구 급매").filters).toMatchObject({ sido: "부산광역시", sgg: "26350", types: ["flagship", "lowdeal"] });
    expect(ruleParse("대구 중구").filters.sgg).toBe("27110");
  });

  it("understands 일반구 names and 시도 alone", () => {
    expect(ruleParse("분당구 대장 아파트").filters).toMatchObject({ sgg: "41135", types: ["flagship"] });
    expect(ruleParse("경기도 전체").filters).toMatchObject({ sido: "경기도", sgg: null });
  });

  it("reads price ranges, bands and approximate prices", () => {
    expect(ruleParse("10억에서 15억 사이").filters).toMatchObject({ priceMin: 100_000, priceMax: 150_000 });
    expect(ruleParse("9억대").filters).toMatchObject({ priceMin: 90_000, priceMax: 99_999 });
    expect(ruleParse("8억 5천 정도").filters).toMatchObject({ priceMin: 76_500, priceMax: 93_500 });
    expect(ruleParse("20억 이상").filters).toMatchObject({ priceMin: 200_000, priceMax: null });
  });

  it("maps 평 and ㎡ to the area bands", () => {
    expect(ruleParse("24평").filters.area).toBe("s");
    expect(ruleParse("34평").filters.area).toBe("m");
    expect(ruleParse("114㎡").filters.area).toBe("l");
    expect(ruleParse("대형 평수").filters.area).toBe("xl");
  });

  it("keeps the current filters for follow-ups and resets on request", () => {
    const cur = { ...NL_DEFAULTS, sgg: "11680", priceMax: 150_000 };
    expect(ruleParse("30% 이상으로", cur).filters).toMatchObject({ sgg: "11680", priceMax: 150_000, discountMin: 30 });
    expect(ruleParse("조건 초기화", cur).filters).toMatchObject({ sgg: null, priceMax: null });
  });

  it("reads 신축, period, volume, average, sort and view", () => {
    const f = ruleParse("신축 최근 6개월 거래 10건 이상 평당가 낮은 거 싼 순으로 목록").filters;
    expect(f).toMatchObject({ built: 5, days: 180, volumeMin: 10, belowAvg: true, sort: "price", view: "list" });
  });

  it("reports what it cannot filter yet", () => {
    expect(ruleParse("역세권 전세가율 높은 대단지").unsupported).toEqual(["역세권", "전세가율·갭투자금", "세대수"]);
  });
});

describe("normalizeFilters", () => {
  it("drops invalid values and keeps the base for missing ones", () => {
    const base = { ...NL_DEFAULTS, days: 180 };
    const f = normalizeFilters({ sido: "없는도", sgg: "99999", types: ["auction", "x"], discountMin: 23, area: "huge", priceMin: 300_000, priceMax: 100_000 }, base);
    expect(f).toMatchObject({ sido: "서울특별시", sgg: null, types: ["auction"], discountMin: 25, area: "all", priceMin: 100_000, priceMax: 300_000, days: 180 });
  });

  it("derives the 시도 from the 시군구 and clears 법정동 without one", () => {
    expect(normalizeFilters({ sgg: "26350", umd: "우동" })).toMatchObject({ sido: "부산광역시", sgg: "26350", umd: "우동" });
    expect(normalizeFilters({ umd: "우동" }).umd).toBeNull();
  });
});

describe("describeFilters", () => {
  it("summarizes the filters", () => {
    expect(describeFilters({ ...NL_DEFAULTS, sgg: "11680", priceMax: 150_000, types: ["auction"] })).toBe("서울특별시 강남구 · 공매 · 15억 이하 · 할인율 15% 이상");
  });
});
