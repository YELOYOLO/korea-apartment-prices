"use client";

import { useRouter } from "next/navigation";
import { DEFAULT_FILTERS, serializeFilters } from "@/lib/search";
import { AgentBar } from "./AgentBar";

const HOME_EXAMPLES = ["강남구 15억 이하 국평 20% 싼 거", "부산 해운대구 공매", "분당 신축 대장 급매", "마포구 래미안 아파트"];

/** Home search box: the request is turned into map-search filters and opens /map with them. */
export default function HomeSearch() {
  const router = useRouter();
  return (
    <AgentBar
      filters={DEFAULT_FILTERS}
      examples={HOME_EXAMPLES}
      onApply={(f) => {
        const qs = serializeFilters(f);
        router.push(`/map${qs ? `?${qs}` : ""}`);
      }}
    />
  );
}
