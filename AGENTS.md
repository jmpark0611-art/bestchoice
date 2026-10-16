# 인수인계: 결정해줘 / Bestchoice (앱인토스 미니앱)

다른 AI·개발자가 이어서 작업하기 위한 문서. 마지막 갱신 2026-10-16 (분야·시급도 DB 적용, decision-ai v10 배포).
이 저장소 작업 브랜치: `claude/bestchoice-miniapp-dev-ar5jtm`.

## 0. 출시 현황 (2026-10-16) — 먼저 읽을 것
| 버전 | 상태 | 내용 |
|---|---|---|
| `20261007-3` | 이전 출시 버전(교체됨) | 10/07 샌드박스 테스트용 번들. **AI 꺼짐**(`VITE_ENABLE_AI=false`) → 고민을 적어도 "AI 분석을 준비하고 있어요"만 표시됨 |
| `20261015-4` | **현재 출시됨** (10/16 승인·출시) | AI 켜짐 정식 번들. `codex/review-remote-ai` 기준 `npm run build:release`로 빌드(테스트 35개·출시 전 점검 통과). AI 스크린샷 자동 채우기 체크 |
| `20261007-1`, `-2` | 검토 필요(미사용) | 쓰지 않음. 검토 요청하지 말 것 |

- 검증: 10/15 12:17 샌드박스 iPhone에서 `20261015-4`로 고민 등록 → 질문 3개(약 8초) → 6축 분석(약 5초) → 결과·실제 선택 저장까지 성공.
  모델 `gpt-4.1-mini-2025-04-14`, 프롬프트 `decision-v1`.
- `ALLOWED_ORIGINS` 등록 완료(10/15, 사용자가 대시보드에서 직접):
  `https://bestchoice.apps.tossmini.com,https://bestchoice.private-apps.tossmini.com`
  - 두 주소 모두 요청 로그 Referer로 확인 완료. 정식: 10/16 14:35 `https://bestchoice.apps.tossmini.com`에서 고민 등록 → 질문 → 6축 분석 → 실제 선택 저장 성공
  - 이 값이 없으면 decision-ai가 토스 WebView 요청을 전부 `403 ORIGIN_DENIED`로 거부함.
- 10/07~10/15 실제 사용자 고민 4건이 AI 꺼진 번들 때문에 `draft`로 멈춤(2개월 후 자동 삭제됨).

### 다음 할 일 (순서)
1. ~~`20261015-4` 출시~~ 완료(10/16)
2. ~~정식 앱 실기기 테스트~~ 완료(10/16, 정상)
2-1. 콘솔 상단 배너의 **활성·전환 지표** 설정 권장(노출·추천 최적화). 제안: 활성=고민 등록, 전환=결과 리포트 열람
3. OpenAI 지출: Default project에 월 $10 한도·100% 알림 설정 완료(10/15, 이때까지 사용액 $0.01). 단 한도는 'not enforced'(알림만) → 실제 상한은 선불 충전액($5, 자동 충전 꺼짐 확인 필요). 50% 알림 추가 권장
4. 검수 반려 시: 사유 확인 → `codex/review-remote-ai` 기반으로 수정 → `npm run build:release`로 재빌드
   (`app/.env`에 `VITE_ENABLE_AI=true`, 실제 publishable 키 필요. `.env`·`.ait`는 커밋 금지)

### 다음 버전 작업 (수익화 + 노출 정책 대응, 2026-10-15~16, **미출시**)
- 사용자 결정: **보상형 광고**, **하루 무료 3건**(이후 광고 1회 = 1건, 하루 최대 5건 추가), 노출 정책 문서 기반 개선 1~4번
- 앱(이 브랜치, 테스트 54개 통과)
  - `lib/rewardedAd.ts`: `loadFullScreenAd`/`showFullScreenAd`, `userEarnedReward` 후 닫힐 때만 보상. 입력 화면 "오늘 남은 분석 N건", 무료 소진 시 "광고 보고 1건 더 받기"
  - `lib/analytics.ts`: `Analytics.log` 이벤트 `decision_submitted`, **`result_viewed`(콘솔 전환 지표로 등록할 것)**, `actual_choice_saved`, `ad_reward_earned`.
    첫 실제 선택 기록 후 `Review.request` 1회
  - 입력 화면: 퀘스트 장식(이모지, 🔮, 단계 지도) 제거, 분야·시급도를 **선택 사항**으로 바꾸고 서버로 전송(`createDecision(text, {category, urgency})`)
  - 질문 화면: "단서 N개 발견", 카드 뭉치, QUESTION/A·B 토큰 제거. 버튼 "다음 질문"/"분석 결과 보기". 홈의 장식 그래픽 제거
- DB
  - `20261016144810_bc_free_quota_and_ad_bonus.sql` **원격 적용됨(10/16)**. 무료 한도는 `bc_app_settings.free_daily_limit`(현재 **20** = 기존과 동일).
    **광고 버전 출시 직후** `update public.bc_app_settings set free_daily_limit = 3 where id = 1;` (되돌리기는 20)
  - `20261016150131_bc_decision_context.sql` **원격 적용됨(10/16)**. `bc_decisions.user_category/urgency` 추가, `bc_create_decision` 4인자 버전(기본값 없음) 추가.
    2인자 버전은 4인자로 위임하는 호환용으로 유지(PostgREST가 보낸 인자 이름으로 고르므로 모호하지 않음. 구버전 앱이 내려간 뒤 삭제 가능).
    첫 시도는 `DROP FUNCTION`이 들어 있어 MCP 적용이 확인 대기 후 취소됨 → DROP 없는 방식으로 바꿔 적용. 로컬 검증(2·4인자 호출, 값 검증, 한도, anon 차단) 후 적용, advisors 새 경고 없음
- Edge Function `decision-ai` **v10 배포됨(10/16)**, 프롬프트 버전 `decision-v2`. 분야·시급도를 AI 입력 `context`로 전달, 시급도에 따라 `nextAction.timeframeHours`를 24/48/72로 고정.
  분야·시급도가 없으면(현재 출시 앱) `context=null`로 이전과 같게 동작. 저장소 파일이 배포본 그대로
- 광고 보상 한계: 클라이언트 신고 기반(서버 검증 불가), 익명 계정 재생성 시 무료 한도 초기화. 전체 일일 100회 상한이 최종 방어선
- 출시 순서: ~~① context 마이그레이션 적용~~ → ~~② decision-ai 배포~~ (10/16 완료) → ③ `.env`에 `VITE_AD_GROUP_REWARDED` + 정책 새 시행일 → `npm run build:release`
  → ④ 샌드박스 테스트 → ⑤ 검토·출시 → ⑥ `free_daily_limit = 3` → ⑦ 콘솔에서 `result_viewed`를 전환 지표로 등록

### 브랜치
- 실제 출시 코드는 `codex/review-remote-ai`(Codex 작업: 퀘스트형 UI, appName 소문자 `bestchoice`, 정책 시행일 확정, 출시 전 점검·AI 스모크 테스트 스크립트).
- 2026-10-15에 이 브랜치를 `claude/bestchoice-miniapp-dev-ar5jtm`에 병합함. 두 브랜치 내용 동일 + 이 문서 갱신.

## 1. 현재 상태 한눈에
- 앱은 `app/`. 2026-09-29 Claude가 재구축(원래 Codex 소스는 유실) → 10/04~10/15 Codex가 이어서 개선·출시 준비.
- 이 저장소에 있는 것: 앱(`app/`), Supabase 마이그레이션, Edge Function 소스, 정책 문서, 출시 체크리스트(`docs/release-checklist.md`).
- **1차 출시 방향: AI 판단 흐름(`bc_*`)으로 결정 (2026-09-29, 사용자).**
  단, 사용자 요청: **"나중에 다른 AI에게도 이 결정이 맞는지 물어보자."** → 이 문서를 읽는 AI는 작업 시작 시
  아래 두 방향의 장단점을 검토해 사용자에게 의견을 한 번 제시할 것 (결정을 뒤집지는 말고 의견만).
- 방향 두 갈래 배경:
  - 최초 작업지시서: 1차 = 랜덤 뽑기 + 친구 투표, AI는 2차 → 스키마 `decisions/options/votes`
  - 다른 AI가 실제로 만든 것: AI 판단 보조(고민 → 확인 질문 3개 → 6축 분석 → 실제 선택 기록) → 스키마 `bc_*`
  - 출시 체크리스트(사용자 제공)는 `bc_*` AI 흐름 기준으로 작성됨.

## 2. 인프라
- Supabase 프로젝트 `njrtcxohbkfgrgwhlvua`(서울). 클라이언트는 publishable 키 사용(레거시 anon 키 X).
- 인증: Supabase 익명 로그인. 토스 로그인(appLogin → 인가코드 → userKey 매핑)은 **아직 미구현**.
- Edge Functions
  - `decision-ai` (verify_jwt=false, 내부에서 사용자 토큰 검증). OpenAI Responses API 사용.
    secrets: `OPENAI_API_KEY`, `OPENAI_MODEL`, `ALLOWED_ORIGINS`. 저장소 파일은 배포 번들 사본(원본 소스는 이전 환경에만 있음).
  - `toss-mtls-test`: 토스 mTLS 확인용. 한 번도 호출된 적 없음. secrets `TOSS_MTLS_CERT`, `TOSS_MTLS_KEY` 미등록 상태로 추정. 확인 후 삭제 예정.
- 상세: `supabase/README.md`

## 3. 이 세션(Claude)이 한 작업
1. `.gitignore`: 인증서/키(`*.pem *.crt *.key *.p12 *.pfx`), `.env*` 커밋 차단.
2. 원격 DB/함수를 저장소로 회수
   - 기록된 마이그레이션 2개 원문 저장
   - 기록 없이 적용돼 있던 `bc_*` 스키마를 카탈로그에서 역추출 → `20260927110000_bc_ai_decision_schema.sql`
     (원격 schema_migrations에는 없음. 재적용 금지, `supabase migration repair --status applied 20260927110000`로 기록만 맞출 것)
   - `decision-ai` v8 배포본 저장
   - 빈 Postgres 16 + auth 스텁으로 전체 마이그레이션 적용·흐름 테스트 통과
3. 버그 수정 (원격 적용 완료, `20260929051831_bc_ai_retry_and_user_limit.sql`)
   - AI 실패 후 같은 결정이 영구히 `PREVIOUS_FAILED`가 되던 문제 → 실패/2분 초과 running은 재시도 허용
   - AI 일일 한도 100회가 전체 공용이던 문제 → 사용자당 10회 한도 추가(전체 100회는 비용 상한으로 유지)
   - 로컬에서 재시도·늦은 응답 무시·한도 초과 롤백 시나리오 검증, 원격 적용 후 advisors 새 경고 없음
4. 보관기간·계정 삭제 (원격 적용 완료, `20260929093527_bc_retention_and_account_delete.sql`)
   - 사용자 결정: 기록 2개월 보관 후 삭제, 앱 내 계정 삭제 버튼, 시행일 = 검수 요청일
   - pg_cron `bc-purge-expired` 매일 03:00 KST, `bc_delete_account()` RPC. 로컬 검증 후 적용
6. 앱 재구축 (`app/`)
   - React 18 + Vite 6 + TypeScript, `@apps-in-toss/web-framework` 3.6.0, `@toss/tds-mobile(-ait)` 2.5.1, Supabase JS
   - 화면: 홈(최근 3개) / 고민 입력(20~1,000자, AI 안내) / 확인 질문 3개 / 6축 결과 + 실제 선택 기록 / 위기 안내 /
     기록(2개월 자동 삭제 안내, 전체 삭제) / 설정(정책 3종, 전체 삭제, 계정 삭제, 문의)
   - 정책 화면은 `docs/legal/*.md`를 빌드 시 그대로 포함 → 문서만 고치면 앱에 반영
   - 딥링크 경로 `/input`, `/history`. 시스템 뒤로가기 `graniteEvent.backEvent` → 앱 내 뒤로, 첫 화면이면 `Screen.close()`
   - `VITE_ENABLE_AI=false`면 AI 호출 없이 "준비 중" 표시(가짜 결과 없음)
   - 검증: `npm test` 35개 통과, `npm run build`로 `Bestchoice.ait` 생성, 브라우저(Supabase mock) 화면 확인
   - **앱인토스 문서 접속이 막힌 상태에서 SDK 패키지의 타입 정의·CLI 도움말만 보고 구현함.** 아래 항목은 문서/실기기로 반드시 확인:
     1) backEvent 구독 시 기본 뒤로가기 동작이 대체되는지 2) 번들 자산 경로(`/assets/...` 절대경로)가 CDN에서 맞는지
     3) 딥링크가 `/input` 경로로 열리는지 4) 실제 WebView Origin 5) TDS 아이콘(static.toss.im) 로딩
7. 정책 문서 초안 `docs/legal/` (개인정보처리방침, 이용약관, AI 안내). 운영자 에스케이컴퍼니/대표 박지민/문의 jmpark0611@gmail.com.
   `[확정 필요]` 표시 항목 남아 있음. 법률 자문 아님.

## 4. 남은 일 (우선순위)
사용자가 해야 할 것
- OpenAI 충전(실제 흐름 테스트 직전), 지출 한도·알림 설정
- 정식 출시 후 실제 요청 주소가 `ALLOWED_ORIGINS`와 맞는지 확인 (0장 참고)
- 토스 mTLS 인증서/키를 Supabase secrets에 직접 등록
- 주요 기능 딥링크는 소문자 `intoss://bestchoice/input`, `intoss://bestchoice/history`

코드로 할 것
- 앱인토스 문서 접속 가능해지면 6번의 "반드시 확인" 5개 항목을 문서와 대조
- TDS 번들이 약 1.25MB(gzip 400KB)로 큼. 실기기 성능 확인 후 필요하면 화면별 지연 로딩
- 토스 로그인 Edge Function (인가코드 → 토큰 → userKey 복호화 → 익명 계정 매핑). mTLS 연결 확인이 선행돼야 함
- `bc_*`와 `decisions/options/votes` 중 어느 쪽을 1차 출시에 쓸지 결정 후 사용하지 않는 쪽 정리

## 5. 반드시 지킬 규칙
- 인증서·키·API 키 내용을 출력·로그·커밋 금지
- DB 스키마 변경은 마이그레이션으로만, 적용 후 Supabase advisors 점검, 로컬 파일명은 원격 버전과 일치시킬 것
- 토스 API 응답은 `resultType` 먼저 검사
- iframe 사용 금지(앱인토스 심사 반려 사유)
- 앱인토스 스펙은 추측하지 말고 https://developers-apps-in-toss.toss.im 문서 확인
- Edge Function CORS 허용 Origin 후보(작업지시서 기준, 실제 Origin 확인 후 확정):
  `https://bestchoice.apps.tossmini.com`, `https://bestchoice.private-apps.tossmini.com`,
  `https://bestchoice.web.tossmini.com`, `https://bestchoice.private-web.tossmini.com`
  (2026-10-07 콘솔 화면에서 appName `bestchoice` 소문자로 확인. 번들과 딥링크도 동일하게 사용)

## 6. 앱 개발 방법
```bash
cd app
cp .env.example .env   # URL, publishable 키 채우기 (.env는 커밋 금지)
npm install
npm run dev        # 브라우저 개발 (@apps-in-toss/devtools가 SDK를 mock)
npm test           # vitest
npm run build      # 타입체크 + vite build + ait build → Bestchoice.ait
npm run build:release # 전체 테스트 + AI 활성화/환경/정책 검사 후 출시 번들 생성
```

## 7. 환경 메모
- Claude 클라우드 세션은 네트워크 정책상 `*.supabase.co`, `developers-apps-in-toss.toss.im` 직접 접속 불가. Supabase는 MCP로만 작업함.
