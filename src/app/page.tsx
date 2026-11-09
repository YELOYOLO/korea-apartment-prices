import Link from "next/link";
import { buttonClass } from "@/components/ui";

export default function Home() {
  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 py-10">
      <section className="space-y-4">
        <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl">
          시세보다 싼 아파트,
          <br />
          실거래가로 확인하세요
        </h1>
        <p className="max-w-2xl text-text-secondary">
          지역마다 대장 아파트를 골라 시세보다 15% 이상 싸게 거래된 건을 모으고, 찾아본 매물의 호가와 온비드 공매 물건을 같은 단지·같은 면적의 최근 국토교통부 실거래가와 비교합니다. 전국 256개 시군구 아파트 매매가 대상입니다.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/bargains" className={buttonClass("primary")}>
            대장 아파트 급매 보기
          </Link>
          <Link href="/watch" className={buttonClass("secondary")}>
            내 관심 매물 비교하기
          </Link>
          <Link href="/auctions" className={buttonClass("secondary")}>
            공매 물건 보기
          </Link>
        </div>
      </section>
      <section className="grid gap-4 sm:grid-cols-2">
        {[
          { t: "대장 아파트 급매", d: "시군구마다 ㎡당 가격이 가장 높은 3개 단지를 골라, 최근 90일 동안 시세보다 15% 이상 싸게 거래된 건과 공매를 보여줍니다." },
          { t: "실거래 기준 시세", d: "같은 단지, 비슷한 전용면적, 최근 6~12개월 실거래의 ㎡당 중위가로 시세를 추정하고 층을 보정합니다." },
          { t: "싼 이유까지 표시", d: "5~15% 저렴하면 추천, 15~25%는 이유 확인, 25% 넘게 싸면 미끼매물 의심으로 따로 표시합니다." },
          { t: "공매는 위험도 함께", d: "최저입찰가를 시세와 비교하고 명도 책임, 지분 물건, 유찰 이력을 경고로 보여줍니다." },
        ].map((c) => (
          <div key={c.t} className="rounded-xl border border-border bg-surface p-4">
            <p className="font-bold">{c.t}</p>
            <p className="mt-1 text-sm text-text-secondary">{c.d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
