"use client";

import { useMemo } from "react";
import { KR_REGIONS, KR_SIDO, krRegion } from "@kr/regions.ts";
import { SelectField } from "./ui";

export type Region = { sido: string | null; lawdCd: string | null };

/** 시도 + 시군구 selects. lawdCd null means "no 시군구": with allowWholeSido, the whole 시도. */
export function RegionPicker({ value, onChange, allowWholeSido = false, idPrefix }: { value: Region; onChange: (r: Region) => void; allowWholeSido?: boolean; idPrefix: string }) {
  const sido = value.sido ?? krRegion(value.lawdCd)?.sido ?? null;
  const options = useMemo(() => KR_REGIONS.filter((r) => r.sido === sido).sort((a, b) => a.name.localeCompare(b.name, "ko")), [sido]);
  return (
    <div className="grid grid-cols-2 gap-3">
      <SelectField id={`${idPrefix}-sido`} label="시도" value={sido ?? ""} onChange={(e) => onChange({ sido: e.target.value || null, lawdCd: null })}>
        <option value="">선택</option>
        {KR_SIDO.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </SelectField>
      <SelectField id={`${idPrefix}-sgg`} label="시군구" value={value.lawdCd ?? ""} disabled={!sido} onChange={(e) => onChange({ sido, lawdCd: e.target.value || null })}>
        <option value="">{allowWholeSido ? "시군구 전체" : "선택"}</option>
        {options.map((r) => (
          <option key={r.code} value={r.code}>
            {r.name}
          </option>
        ))}
      </SelectField>
    </div>
  );
}

/** Per-device memory of the last region (a convenience only). */
export function readStoredRegion(key: string): Region {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null") as { sido?: unknown; lawdCd?: unknown } | null;
    const sido = typeof v?.sido === "string" && KR_SIDO.includes(v.sido) ? v.sido : null;
    const lawdCd = typeof v?.lawdCd === "string" && krRegion(v.lawdCd)?.sido === sido ? v.lawdCd : null;
    return { sido, lawdCd };
  } catch {
    return { sido: null, lawdCd: null };
  }
}

export function storeRegion(key: string, v: Region) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* per-device convenience only */
  }
}
