# 인수인계: 결정해줘 / Bestchoice (앱인토스 미니앱)

다른 AI·개발자가 이어서 작업하기 위한 문서. 마지막 갱신 2026-10-16 (분야·시급도 DB 적용, decision-ai v10 배포).
이 저장소 작업 브랜치: `claude/bestchoice-miniapp-dev-ar5jtm`.

## 0. 출시 현황 (2026-10-16) — 먼저 읽을 것
| 버전 | 상태 | 내용 |
|---|---|---|
| `20261007-3` | 이전 출시 버전(교체됨) | 10/07 샌드박스 테스트용 번들. **AI 꺼짐**(`VITE_ENABLE_AI=false`) → 고민을 적어도 "AI 분석을 준비하고 있어요"만 표시됨 |
| `20261015-4` | **현재 출시됨** (10/16 승인·출시) | AI 켜짐 정식 번들. `codex/review-remote-ai` 기준 `npm run build:release`로 빌드(테스트 35개·출시 전 점검 통과). AI 스크린샷 자동 채우기 체크 |
| `20261007-1`, `-2` | 검토 필요(미사용) | 쓰지 않음. 검토 요청하지 말 것 |
| (업로드 후 기입) | **빌드 완료, 업로드 대기** (10/17) | UI 개편 버전(B안: 화면 먼저, 광고 꺼짐). 앱 이름 **결정해줘** 유지(13:34 재빌드, 사용자가 앞선 업로드를 검토 요청 취소함). 이 브랜치 `npm run build:release` → `release/bestchoice-20261017-ui.ait`(1.4MB). 테스트 56개·사전점검 통과, AI 켜짐 확인, 광고 그룹 ID 없음, 정책 시행일 10/17 |

- 검증: 10/15 12:17 샌드박스 iPhone에서 `20261015-4`로 고민 등록 → 질문 3개(약 8초) → 6축 분석(약 5초) → 결과·실제 선택 저장까지 성공.
  모델 `gpt-4.1-mini-2025-04-14`, 프롬프트 `decision-v1`.
- `ALLOWED_ORIGINS` 등록 완료(10/15, 사용자가 대시보드에서 직접):
  `https://bestchoice.apps.tossmini.com,https://bestchoice.private-apps.tossmini.com`
  - 두 주소 모두 요청 로그 Referer로 확인 완료. 정식: 10/16 14:35 `https://bestchoice.apps.tossmini.com`에서 고민 등록 → 질문 → 6축 분석 → 실제 선택 저장 성공
  - 이 값이 없으면 decision-ai가 토스 WebView 요청을 전부 `403 ORIGIN_DENIED`로 거부함.
- 10/07~10/15 고민 4건이 AI 꺼진 번들 때문에 `draft`로 멈춤(2개월 후 자동 삭제됨). 10/17 재확인: 3건은 정식 출시(10/15 20:43) 전이라 샌드박스·검수 테스트로 보이고, 1건은 사용자 본인 기기. **10/17 기준 외부 실사용자 확인 안 됨**(익명 계정 11개 모두 개발·테스트·검수 시점과 일치)

### 다음 할 일 (순서)
1. ~~`20261015-4` 출시~~ 완료(10/16)
2. ~~정식 앱 실기기 테스트~~ 완료(10/16, 정상)
2-1. 콘솔 상단 배너의 **활성·전환 지표** 설정 권장(노출·추천 최적화). 제안: 활성=고민 등록, 전환=결과 리포트 열람
3. OpenAI 지출: Default project에 월 $10 한도·100% 알림 설정 완료(10/15, 이때까지 사용액 $0.01). 단 한도는 'not enforced'(알림만) → 실제 상한은 선불 충전액($5, 자동 충전 꺼짐 확인 필요). 50% 알림 추가 권장
4. 검수 반려 시: 사유 확인 → `codex/review-remote-ai` 기반으로 수정 → `npm run build:release`로 재빌드
   (`app/.env`에 `VITE_ENABLE_AI=true`, 실제 publishable 키 필요. `.env`·`.ait`는 커밋 금지)

### 10/17 B안 (사용자 결정: 화면 개편 먼저 출시, 광고는 다음 버전)
- 정책: 광고 조항 버전은 `docs/legal/next/`로 이동(README 참고). `docs/legal/`는 출시본(10/15)에 개인정보처리방침만 한 줄 보강
  (분야·시급도 수집, 이용 이벤트의 토스 통계 전송) → 시행일 2026-10-17(사용자 원칙: 시행일=검수 요청일). 약관·AI 안내는 10/15 그대로
- `preflight-release.mjs`: 광고 그룹 ID 유무와 약관의 보상형 광고 조항이 일치해야 통과(광고 없는 빌드 허용)
- 무료 한도는 DB `free_daily_limit = 20` 유지. 광고 버전 출시 때 3으로

### 사용자 할 일 체크리스트 (2026-10-17, 사용자 요청: "광고부터 내가 해야 할 건 기억했다가 다시 알려줘")
AI는 작업 보고 끝에 이 목록의 남은 항목을 다시 알려줄 것. 완료되면 ~~취소선~~ 처리.
1. [ ] 콘솔 사업자 정보 확인(워크스페이스 → 파트너 정보 → 사업자 정보) — 광고는 사업자 등록 필수
2. [ ] 콘솔 정산 정보 등록(나의 워크스페이스 → 정보 → 정산 정보, 통장 사본)
3. [ ] 보상형 광고 그룹 만들기 → **광고 그룹 ID** 전달 (유형 보상형, 보상 단위 "분석", 수량 1. 등록 후 최대 2시간 뒤 활성)
4. [ ] 새 정책 **시행일**(광고 버전 출시 예정일) 정해서 전달
5. [ ] 콘솔 활성·전환 지표 설정: 활성=고민 등록, 전환=`result_viewed`(결과 보기)
6. [ ] OpenAI: 50% 지출 알림 추가, 자동 충전 꺼짐 확인
7. [ ] (빌드 후) 샌드박스 테스트(테스트 광고 ID `ait-ad-test-rewarded-id` 번들)를 **아이폰·안드로이드 각 1대**에서 → 실제 ID 번들로 검토 요청 → 출시
   (확인할 것: 주아 글꼴 표시, 결과 화면 기준 누르면 펼쳐짐, 홈·입력·질문이 스크롤 없이 한 화면, 안드로이드 큰 글씨 설정에서 깨짐 없음)
8. [ ] 출시 직후 AI에게 무료 한도 3건 전환 요청(`free_daily_limit = 3`)
9. [ ] 딥링크 `intoss://bestchoice/input`으로 지인에게 공유해 첫 사용자 모으기 (10/17 기준 외부 실사용자 0명)

### UI 단순화 (2026-10-17, 미출시, 이 브랜치)
- 사용자 요청: 심플한 구성, 글자 수 줄이기, 호기심 자극
- 홈: "할까, 말까?" / "질문 3개면 답이 보여요" / 고민 적기 → 질문 3개 → 결론, CTA "고민 털어놓기". 3단계 설명 카드 제거
- 입력: 제목 "무슨 고민이에요?", 부제 제거, AI 안내 7줄은 한 줄 요약 + "자세히"로 접음(전문은 그대로 포함)
- 질문: 상단 제목 제거, 질문 자체를 큰 제목으로, "1 / 3", 요약은 첫 질문에서만 한 줄. 버튼 "다음"/"결론 보기"
- 로딩: 문구가 2.5초마다 바뀜("6가지 기준으로 따져보는 중" → "놓친 점을 찾는 중" → "결론을 정리하는 중")
- 결과: "결론" + 추천안을 제목으로, 근거 1개 → 48시간 할 일 → 6가지 기준 막대(누르면 이유) → 놓친 점/다른 선택 조건은 접기
- 퀘스트 UI 시절 안 쓰는 CSS 정리. 테스트 55개 통과
- 10/17 2차: 제목 글꼴 **주아(Jua, OFL)** — 사용자 요청 "귀여운 쪽". 후보 비교(주아·고운돋움·개구·동글) 후 읽기 쉬운 주아 선택.
  `@fontsource/jua`를 의존성으로 두고 `src/fonts/jua.css`(woff2만, unicode-range 조각)로 번들에 포함 → 외부 네트워크 불필요, 번들 +약 1MB(화면에 쓰인 글자 조각만 받음).
  본문·버튼은 기존 글꼴. 제목류(`.display` 등)만 `--bc-display`
- 폰 비율: `.page-inner` 최소 높이 + `.page` 하단 여백 때문에 모든 화면이 항상 약 120px 스크롤되던 문제 수정.
  측정(390×790): 홈·입력·질문·로딩 한 화면, 결과만 스크롤(+381). 작은 폰(360×680): 입력 +47, 결과 +512.
  결과 6가지 기준은 한 줄씩, 실제 선택은 3칸 한 줄(메모는 선택 후 표시), 분야 칩 짧게(일/돈/관계/도전/기타). 홈은 제목+버튼을 세로 가운데 배치
- 10/17 3차 아이폰·안드로이드 호환: `:has()`(iOS 15.4 미만·구형 안드로이드 WebView 미지원) 제거 → `Page fixedCta={false}` 클래스,
  `<summary>`에 직접 grid/flex 금지(구형 iOS Safari) → 안쪽 span에 배치, 안드로이드 탭 하이라이트 제거, 하단 버튼 자리 104→84px.
  화면 높이별 조정(760/700/640px). 토스 상단 바를 뺀 실제 높이로 측정(Chromium):
  iPhone SE 375×603 홈·질문 한 화면/입력 +23, iPhone 13·14 390×719·Pro Max·갤럭시 360×684·Pixel 412×819 홈·입력·질문 모두 한 화면, 결과만 스크롤.
  **이 환경엔 WebKit(아이폰 엔진)이 없어 아이폰은 실기기 확인 필요**
- 10/17 4차 (사용자: "누가 봐도 결정 못 하는 걸 결정해주는 앱이구나 하고 실행할 수 있게"):
  홈 부제 "질문 3개만 답하면 **대신 정해드려요**", 예시 칩 3개(이직할까?/살까 말까?/연락할까? → 누르면 그 문장이 채워진 입력 화면),
  시작 버튼 = 앱 이름 "결정해줘", 입력 제목 "뭘 못 정하겠어요?", 결과 머리말 "결정했어요". 테스트 56개
- 10/17 5차: 사용자 결정으로 **앱 표시 이름 "결정해줘" → "딱정해"**. 홈 로고·`index.html` 제목·시작 버튼("딱 정해줘") 변경.
  appName·딥링크·`ALLOWED_ORIGINS`의 `bestchoice`는 그대로(식별자). 토스 상단 바·앱 목록의 이름은 **콘솔 앱 정보에서 사용자가 변경**해야 함
  → 같은 날 사용자 결정으로 **보류, "결정해줘"로 되돌림**(콘솔 이름과 앱 안 이름이 다르면 검토 반려 사례가 있어 함께 바꿔야 함). 이름 변경은 나중에 콘솔 앱 정보 변경과 같이 진행

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
  분야·시급도가 없으면(현재 출시 앱) `context=null`로 이전과 같게 동작. 저장소 파일이 배포본 그대로.
  10/16 16:13(UTC) 출시 앱으로 실사용 확인: 질문(약 4.5초)·6축 분석(약 5초) 모두 200, 결과 `decision-v2`로 저장
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
