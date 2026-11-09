import { describe, expect, it } from "vitest";
import {
  activeChips,
  clusterItems,
  DEFAULT_FILTERS,
  markerLabel,
  parseFilters,
  priceRangeLabel,
  regionCodes,
  serializeFilters,
  toSearchArgs,
  type SearchFilters,
} from "../src/lib/search";

describe("filters in the URL", () => {
  it("round-trips every filter", () => {
    const f: SearchFilters = {
      sido: "서울특별시",
      sgg: "11680",
      umd: "대치동",
      apt: "래미안",
      types: ["flagship", "auction"],
      priceMin: 90_000,
      priceMax: 150_000,
      discountMin: 20,
      area: "m",
      built: 10,
      days: 180,
      volumeMin: 10,
      belowAvg: true,
      sort: "volume",
      view: "list",
      bounds: [37.4, 126.9, 37.6, 127.1],
    };
    expect(parseFilters(serializeFilters(f))).toEqual(f);
  });

  it("keeps the defaults out of the URL and restores them", () => {
    expect(serializeFilters(DEFAULT_FILTERS)).toBe("");
    expect(parseFilters("")).toEqual(DEFAULT_FILTERS);
  });

  it("stores 'no discount limit' explicitly", () => {
    const qs = serializeFilters({ ...DEFAULT_FILTERS, discountMin: null });
    expect(qs).toBe("dmin=0");
    expect(parseFilters(qs).discountMin).toBeNull();
  });

  it("drops invalid values", () => {
    const f = parseFilters("sido=없는도&sgg=99999&umd=x&type=foo,auction&pmin=-1&dmin=abc&area=huge&days=9999&sort=x&b=1,2,0,0");
    expect(f.sido).toBeNull();
    expect(f.sgg).toBeNull();
    expect(f.umd).toBeNull(); // no 법정동 without a 시군구
    expect(f.types).toEqual(["auction"]);
    expect(f.priceMin).toBeNull();
    expect(f.area).toBe("all");
    expect(f.days).toBe(90);
    expect(f.sort).toBe("discount");
    expect(f.bounds).toBeNull();
  });

  it("takes the 시도 from the 시군구 and treats all kinds as 'all'", () => {
    const f = parseFilters("sgg=26350&type=flagship,lowdeal,auction");
    expect(f.sido).toBe("부산광역시");
    expect(f.types).toEqual([]);
  });
});

describe("search arguments", () => {
  it("maps filters to kr_search parameters", () => {
    const a = toSearchArgs(
      { ...DEFAULT_FILTERS, sgg: "11680", umd: "대치동", priceMin: 90_000, area: "l", built: 10, discountMin: 20, types: ["lowdeal"] },
      new Date("2026-11-09T00:00:00Z"),
    );
    expect(a).toMatchObject({
      p_lawd_codes: ["11680"],
      p_types: ["lowdeal"],
      p_umd: "대치동",
      p_price_min: 900_000_000,
      p_price_max: null,
      p_discount_min: 0.2,
      p_area_min: 85,
      p_area_max: 115,
      p_built_after: 2016,
      p_days: 90,
      p_limit: 500,
      p_volume_min: null,
      p_below_umd_avg: false,
    });
  });

  it("searches every 시군구 of the 시도 when none is chosen", () => {
    expect(regionCodes({ sido: "서울특별시", sgg: null })).toHaveLength(25);
    expect(toSearchArgs(DEFAULT_FILTERS).p_types).toEqual(["flagship", "lowdeal", "auction"]);
  });
});

describe("labels", () => {
  it("formats marker text", () => {
    expect(markerLabel(850_000_000, 0.2213)).toBe("8.5억 · -22%");
    expect(markerLabel(1_200_000_000, 0.15)).toBe("12억 · -15%");
    expect(markerLabel(95_000_000, 0.3)).toBe("9,500만 · -30%");
    expect(markerLabel(500_000_000, null)).toBe("5억 · 비교 불가");
    expect(markerLabel(500_000_000, -0.04)).toBe("5억 · +4%");
  });

  it("formats price ranges and chips", () => {
    expect(priceRangeLabel(30_000, 60_000)).toBe("3~6억");
    expect(priceRangeLabel(null, 35_000)).toBe("3.5억 이하");
    const chips = activeChips({ ...DEFAULT_FILTERS, priceMin: 150_000, discountMin: null, volumeMin: 5, belowAvg: true, bounds: [1, 2, 3, 4] });
    expect(chips.map((c) => c.label)).toEqual(["15억 이상", "할인율 제한 없음", "최근 1년 거래 5건 이상", "평당가 법정동 평균 이하", "지도 영역"]);
  });
});

describe("clusterItems", () => {
  const items = [
    { id: "a", lat: 37.5, lng: 127.0 },
    { id: "b", lat: 37.5, lng: 127.0 },
    { id: "c", lat: 37.505, lng: 127.005 },
    { id: "d", lat: 37.7, lng: 127.3 },
  ];

  it("always merges items at the same spot", () => {
    const c = clusterItems(items, 16);
    expect(c).toHaveLength(3);
    expect(c.find((x) => x.items.length === 2)!.items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("merges nearby items when zoomed out", () => {
    const c = clusterItems(items, 10);
    expect(c.map((x) => x.items.length).sort()).toEqual([1, 3]);
  });
});
