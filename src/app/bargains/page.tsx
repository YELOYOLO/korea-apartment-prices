"use client";

import dynamic from "next/dynamic";
import { Loading } from "@/components/ui";

const Bargains = dynamic(() => import("@/components/Bargains"), { ssr: false, loading: () => <Loading /> });

export default function BargainsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-extrabold">대장 아파트 급매</h1>
        <p className="text-sm text-text-secondary">지역마다 가장 비싼 대장 아파트를 골라, 시세보다 15% 이상 싸게 거래되거나 공매로 나온 물건을 모아 보여 줍니다.</p>
      </header>
      <Bargains />
    </div>
  );
}
