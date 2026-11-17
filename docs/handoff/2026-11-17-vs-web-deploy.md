# 작업지시서: 결정해지니Genie 웹 버전(A vs B 즉답 + 친구 투표) 배포

작성 2026-11-17. 이 문서만 읽고 처음부터 끝까지 진행할 수 있게 썼다. 막히면 추측하지 말고 사용자에게 물어볼 것.

## 0. 한 줄 요약
코드는 다 만들어져 있고 로컬 검증도 끝났다. **운영 Supabase에 DB 적용 → Edge Function 배포 → 웹을 Vercel에 배포 → 실제 흐름 확인**만 남았다.
기존 토스 미니앱(`app/`, `bc_*` 테이블, `decision-ai` 함수)은 **절대 건드리지 않는다**.

---

## 1. 접속 준비

### 1-1. 저장소
- GitHub: `jmpark0611-art/bestchoice`
- 작업 브랜치: **`claude/bestchoice-miniapp-dev-ar5jtm`** (다른 브랜치에 push 금지, PR은 사용자가 요청할 때만)
```bash
git clone https://github.com/jmpark0611-art/bestchoice.git
cd bestchoice
git checkout claude/bestchoice-miniapp-dev-ar5jtm
```
- 먼저 `AGENTS.md`의 "방향 전환 (2026-11-15)" 절을 읽을 것.

### 1-2. Supabase
- 프로젝트 ID: **`njrtcxohbkfgrgwhlvua`** (서울 리전)
- 프로젝트 URL: `https://njrtcxohbkfgrgwhlvua.supabase.co`
- 접속 방법(둘 중 하나)
  - **Supabase MCP**(권장): 사용자 계정으로 연결된 MCP 도구 `apply_migration`, `execute_sql`, `get_advisors`, `deploy_edge_function`, `get_publishable_keys`
  - **Supabase CLI**: `supabase login` → `supabase link --project-ref njrtcxohbkfgrgwhlvua` (DB 비밀번호·액세스 토큰은 사용자에게 받되 **채팅·파일·커밋에 남기지 말 것**)
- ⚠️ **알려진 문제**: 이전 AI(Claude 클라우드 세션)에서 MCP `apply_migration`이 4번 연속 "사용자 승인 질문에 응답 없음"으로 시간 초과됐다(적용은 0건, 운영 DB 무변경 확인).
  같은 증상이면 반복하지 말고 **사용자에게 대시보드 SQL Editor에서 직접 실행**해 달라고 요청한다(2-1 참고).
- 클라우드 환경에 따라 `*.supabase.co` 직접 접속(curl 등)이 막혀 있을 수 있다. 그 경우 테스트는 브라우저 또는 사용자 기기로 한다.

### 1-3. Vercel
- 계정은 사용자 것. 아직 이 앱용 Vercel 프로젝트는 **없음**.
- Vercel MCP 또는 Vercel CLI(`vercel login`) 사용. 팀/프로젝트를 추측하지 말고 목록 확인 후 사용자에게 확인.

### 1-4. 이미 있는 secret (값은 보지도, 출력하지도 말 것)
- Supabase Edge Function secret: `OPENAI_API_KEY`, `OPENAI_MODEL` (기존 `decision-ai`와 공용, 현재 모델 `gpt-4.1-mini-2025-04-14`)
- 새로 secret을 만들 필요 없음. (선택) `VS_ALLOWED_ORIGINS` secret을 만들면 코드의 허용 주소 목록보다 우선한다.

---

## 2. 작업 순서

### 2-1. DB 마이그레이션 적용
- 파일: `supabase/migrations/20261115000000_vs_polls_and_votes.sql`
- 내용: 새 테이블 `vs_polls`, `vs_votes`, `vs_user_limits`, `vs_daily_total` + RLS + RPC 함수 + pg_cron 정리 작업(`vs-purge-expired`, 매일 03:10 KST).
  새 객체만 만들고 기존 데이터는 건드리지 않는다. 로컬 Postgres 16에서 권한·한도·삭제 시나리오 검증 완료.
- 적용 전 확인(0이어야 함):
```sql
select count(*) from information_schema.tables where table_schema='public' and table_name like 'vs\_%';
```
- 적용 방법
  - MCP: `apply_migration(name="vs_polls_and_votes", query=<파일 내용>)` — 맨 앞에 `set local lock_timeout = '5s';` 한 줄 추가 권장
  - 또는 사용자가 대시보드 → SQL Editor → 파일 내용 붙여넣기 → Run
- 적용 후 확인
```sql
select count(*) from information_schema.tables where table_schema='public' and table_name like 'vs\_%'; -- 4
select version, name from supabase_migrations.schema_migrations where name like 'vs_%';
select jobname, schedule from cron.job where jobname = 'vs-purge-expired';
```
- **로컬 파일명을 원격 버전과 맞춘다**: `schema_migrations`에 기록된 version으로 파일명을 바꾼다(예: `20261117xxxxxx_vs_polls_and_votes.sql`).
  SQL Editor로 실행해서 기록이 없으면 `supabase migration repair --status applied 20261115000000`로 기록만 맞추거나 사용자와 상의.
- **advisors 점검**(security, performance). 새로 생긴 경고만 확인하고 필요하면 후속 마이그레이션으로 고친다.

### 2-2. Edge Function `vs-decide` 배포
- 파일: `supabase/functions/vs-decide/index.ts` (외부 파일 의존 없음, npm: import만 사용)
- **`verify_jwt = false`로 배포**(함수 안에서 `auth.getUser(token)`으로 직접 검증함)
  - MCP: `deploy_edge_function(name="vs-decide", entrypoint_path="index.ts", verify_jwt=false, files=[index.ts])`
  - CLI: `supabase functions deploy vs-decide --no-verify-jwt`
- 동작: 두 선택지(각 1~20자)와 상황 한 줄(최대 60자) → `vs_claim`(사용자 하루 30건·전체 300건) → OpenAI Responses API → `vs_polls`에 저장 → `{kind:"pick", id}` 반환. 위기 표현이면 `{kind:"crisis"}`.
- 허용 Origin: 코드의 `DEFAULT_ORIGINS`(지금은 localhost만). 3단계에서 배포 주소를 추가해 재배포한다.

### 2-3. 웹 빌드·Vercel 배포
- 폴더: `web/` (Vite + React, 토스 SDK 없음). 경로: `/` 입력, `/p/:id` 내 결정, `/v/:code` 친구 투표, `/about` 안내
- publishable 키 확인: MCP `get_publishable_keys` → `sb_publishable_...` 형식 사용 (**레거시 anon JWT 키 사용 금지**)
- 로컬 확인
```bash
cd web
npm install
npm run verify   # 테스트 8개 + 타입체크 통과해야 함
npm run build
```
- Vercel 프로젝트 설정
  - Root Directory: `web`
  - Framework: Vite (Build `npm run build`, Output `dist`)
  - 환경 변수(Production·Preview):
    - `VITE_SUPABASE_URL = https://njrtcxohbkfgrgwhlvua.supabase.co`
    - `VITE_SUPABASE_PUBLISHABLE_KEY = sb_publishable_...` (공개용 키라 노출돼도 되지만 커밋은 하지 않는다. `.env`는 커밋 금지)
  - `web/vercel.json`에 SPA 리라이트가 이미 있음
- 배포 후 주소 확인(예: `https://genie-xxx.vercel.app`). 사용자에게 프로젝트 이름·도메인 확정 여부를 물어볼 것.

### 2-4. 허용 Origin 추가 후 재배포
- `supabase/functions/vs-decide/index.ts`의 `DEFAULT_ORIGINS`에 **배포 주소(프로토콜 포함, 끝 `/` 없이)** 추가 후 `vs-decide` 재배포.
  커스텀 도메인을 붙이면 그것도 추가. Preview 주소까지 열 필요는 없음.
- 이걸 빠뜨리면 브라우저 요청이 `403 ORIGIN_DENIED`로 거부된다.

### 2-5. Supabase Auth 설정 확인
- 익명 로그인(Anonymous sign-ins)이 켜져 있어야 함(기존 미니앱이 이미 사용 중이라 켜져 있을 것). 대시보드 → Authentication → Providers에서 확인만.

### 2-6. 실제 흐름 테스트 (휴대폰 2대 또는 브라우저 2개 — 일반 창 + 시크릿 창)
1. A 브라우저: `/`에서 "짜장면" vs "짬뽕" 입력 → "딱 정해줘" → 결론 화면(`/p/:id`)이 뜨는지
2. "친구한테 물어보기" → 링크 복사(`/v/:code`)
3. B 브라우저(시크릿): 링크 열기 → 투표 전에는 지니의 선택·표 수가 **안 보여야** 함 → 투표 → 결과가 보이는지
4. B에서 다시 눌러도 첫 표가 유지되는지
5. A 새로고침: 표 수가 1로 올라갔는지, "그래서, 뭘로 했어요?" 저장되는지
6. A가 자기 투표 링크를 열면 `/p/:id`로 넘어가는지
7. 다크 모드 폰에서 블랙 팔레트로 보이는지
- 서버 확인
```sql
select count(*) from public.vs_polls; select count(*) from public.vs_votes;
select * from public.vs_daily_total order by day desc limit 3;
```
- Edge Function 로그에서 `vs_decided` 이벤트와 에러 여부 확인. 테스트 데이터는 남겨도 된다(2개월 후 자동 삭제). 지우려면 사용자에게 먼저 물어볼 것.

### 2-7. 마무리
- `AGENTS.md`의 "방향 전환 (2026-11-15)" 절 갱신: 적용된 마이그레이션 버전, `vs-decide` 버전, 배포 주소, 테스트 결과, 남은 일
- 커밋 후 `claude/bestchoice-miniapp-dev-ar5jtm`에 push
- 사용자에게 지인 10~20명 시험용 링크 전달

---

## 3. 반드시 지킬 규칙
- 인증서·키·API 키·DB 비밀번호 내용을 출력·로그·커밋하지 말 것. `.env`, `.ait` 커밋 금지
- DB 스키마 변경은 마이그레이션으로만. 적용 후 advisors 점검. 로컬 파일명은 원격 버전과 일치
- 기존 미니앱 자원(`app/`, `bc_*` 테이블·함수, `decision-ai`, `toss-mtls-test`, `bc_app_settings`) 수정 금지
- 사용자 이메일 등 개인정보를 외부 서비스 요청에 넣지 말 것
- iframe 사용 금지
- 사용자는 한국어로 소통한다. 쉬운 말로 보고할 것

## 4. 문제 해결
| 증상 | 원인·조치 |
|---|---|
| MCP `apply_migration` 시간 초과(승인 질문 응답 없음) | 반복하지 말고 사용자에게 SQL Editor 직접 실행 요청 |
| 브라우저에서 `403 ORIGIN_DENIED` | 2-4 미완료. 정확한 Origin(https://..., 끝 `/` 없음) 추가 후 재배포 |
| `401 AUTH_REQUIRED` | 익명 로그인 꺼짐 또는 키 오류. publishable 키·Auth 설정 확인 |
| `503 NOT_CONFIGURED` | `OPENAI_API_KEY`/`OPENAI_MODEL` secret 누락 |
| `502 AI_QUOTA` | OpenAI 선불 잔액 부족 → 사용자에게 충전 요청 |
| `429 VS_LIMIT` / `VS_BUSY` | 사용자 하루 30건 / 전체 300건 초과(정상 동작) |
| 함수에서 `STORAGE_ERROR` | 마이그레이션 미적용 또는 `vs_claim` 권한 문제. 2-1 확인 |

## 5. 아직 안 만든 것 (이번 작업 범위 아님)
결과 이미지 카드, "질문 3개로 더 정확하게" 연결, 알림, 웹/앱용 정식 개인정보처리방침(현재 `/about`에 요약 안내만), 링크 미리보기 이미지(OG 이미지), 홈·결론 화면 스크롤 소폭 줄이기.
이후 계획: 지인 반응 확인 → 안드로이드(사업자 계정) → 아이폰.

## 6. 참고 파일
- `AGENTS.md` — 전체 인수인계 문서
- `supabase/README.md` — Supabase 구성
- `web/src/lib/api.ts` — 웹이 호출하는 RPC·함수 목록
- 디자인 시안(사용자 비공개): https://claude.ai/artifact/79sbJ176isZpfXLdit4xD7
