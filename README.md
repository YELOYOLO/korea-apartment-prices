# Mydream

전국 아파트 매물·공매를 국토교통부 실거래가와 비교해 시세보다 싼 물건을 먼저 보여주는 사이트입니다.

- **관심 매물** (`/watch`, 로그인 필요): 내가 본 매물의 호가를 입력하면 같은 단지·비슷한 면적의 최근 실거래가와 비교합니다.
  - 시세보다 5~15% 싸면 추천
  - 15~25% 싸면 "싼 이유 확인"
  - 25% 넘게 싸면 의심 매물로 보류
- **온비드 공매** (`/auctions`): 진행 중인 주거용 공매 물건의 최저입찰가를 추정 시세와 비교합니다. 지분 물건은 비교에서 뺍니다.

## 구성

- Next.js 16 (App Router) + React 19 + Tailwind 4, `src/`
- Supabase (프로젝트 `ruyexuwcjilyxvgnxvxt`)
  - `supabase/migrations`: 테이블과 RLS
  - `supabase/functions/sync`: 데이터 수집 Edge Function. pg_cron이 매시간 호출합니다.
    - `{"job":"trades"}`: 실거래가, 한 번에 시군구·월 60건
    - `{"job":"auctions"}`: 온비드, 한 번에 시도 4곳
- 계산 로직은 `supabase/functions/_shared/kr/`에 있고, 웹과 Edge Function이 같이 씁니다.

## 개발

```sh
pnpm install
cp .env.example .env.local   # NEXT_PUBLIC_SUPABASE_ANON_KEY 채우기
pnpm dev
pnpm check                   # typecheck + lint + test
```

## 운영 설정

- Edge Function secret: `MOLIT_SERVICE_KEY`
  - data.go.kr 인증키(Decoding)
  - 온비드도 이 키를 씁니다. 다르면 `ONBID_SERVICE_KEY`를 따로 넣습니다.
- Vault
  - `project_url`
  - `service_role_key`: pg_cron이 함수를 부를 때 씁니다.
- 지역 목록 갱신: `pnpm regions`
  - 법정동코드 전체자료로 `_shared/kr/regions.ts`를 다시 만듭니다.

공공데이터를 보여줄 뿐이며 투자 권유가 아닙니다.
