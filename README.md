# Mydream

전국 아파트 매물·공매를 국토교통부 실거래가와 비교해 시세보다 싼 물건을 먼저 보여주는 사이트입니다.

- **대장 아파트 급매** (`/bargains`): 시군구마다 ㎡당 가격이 가장 높은 3개 단지(최근 1년 거래 5건 이상)를 골라, 최근 90일 동안 시세보다 15% 이상 싸게 거래된 건과 최저가가 시세의 85% 이하인 공매를 보여줍니다.
  - 네이버·KB 매물은 자동 수집하지 않습니다(공개 API 없음, 약관상 자동 수집 금지). 단지마다 검색 링크를 붙입니다.
- **지도 검색** (`/map`): 지역(시도·시군구·읍면동), 단지명, 유형(대장 급매 / 저가 실거래 / 공매), 가격, 시세 대비 할인율, 면적, 준공 연도, 거래 기간, 정렬로 찾고 네이버 지도 마커(`8.5억 · -22%`)나 목록으로 봅니다. 조건은 URL에 저장되고 `현재 지도 영역에서 검색`을 지원합니다.
  - 2차: 거래량(단지 최근 1년·3개월, `kr_lot_stats`) 필터·정렬, 평당가 vs 법정동 중위값(`kr_umd_stats`) 비교·필터, 비교 거래 목록(`kr_comparables`). 검색 함수는 `kr_map_search`.
  - 준비 중: 세대수·전세가율·갭투자금(전월세·공동주택 API 승인 필요), 역세권(역 위치 데이터 필요).
  - 할인율은 `kr_trade_signals` / `kr_auction_signals`에 미리 계산합니다(`kr_refresh_due_signals`, 12분마다). 계산식은 `valuation.ts`와 같고, 실데이터로 대조했습니다.
  - 단지는 시군구+법정동+지번으로 구분합니다(승인된 실거래가 API에는 aptSeq가 없음).
  - 좌표는 `geocode` 함수가 NCP Geocoding으로 10분마다 채웁니다(`kr_geo`).
- **AI 검색 에이전트** (지도 검색 상단): 마이크(브라우저 음성 인식, 한국어) 또는 글자로 "강남구 15억 이하 국평 20% 싼 거"처럼 말하면 조건으로 바꿔 검색합니다. 지금 걸린 조건을 이어받아 "더 싼 순으로" 같은 후속 요청도 됩니다.
  - `ai-search` 함수가 Claude(`claude-opus-5-5`, 구조화 출력)로 해석하고, 결과는 `normalizeFilters`로 검증합니다.
  - `ANTHROPIC_API_KEY`가 없거나 사용량 한도(접속자당 시간당 30회, 사이트 하루 1000회, `kr_ai_take`)를 넘으면 규칙 기반 해석기(`ruleParse`)가 대신 답합니다.
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
cp .env.example .env.local
pnpm dev
pnpm check                   # typecheck + lint + test
```

## 운영 설정

- Edge Function secret: `NAVER_MAP_CLIENT_ID`, `NAVER_MAP_CLIENT_SECRET` (NCP Maps 앱, Dynamic Map + Geocoding, Web 서비스 URL에 사이트 주소 등록)
  - `map-config` 함수가 Client ID를 지도 화면에 넘겨 줍니다(공개 값).
- Edge Function secret: `ANTHROPIC_API_KEY` (AI 검색, 선택)
- Edge Function secret: `MOLIT_SERVICE_KEY`
  - data.go.kr 인증키(Decoding)
  - 온비드도 이 키를 씁니다. 다르면 `ONBID_SERVICE_KEY`를 따로 넣습니다.
- Vault
  - `project_url`
  - `service_role_key`: pg_cron이 함수를 부를 때 씁니다.
- 지역 목록 갱신: `pnpm regions`
  - 법정동코드 전체자료로 `_shared/kr/regions.ts`를 다시 만듭니다.

공공데이터를 보여줄 뿐이며 투자 권유가 아닙니다.
