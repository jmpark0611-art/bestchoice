# 인수인계: 결정해줘 / Bestchoice (앱인토스 미니앱)

다른 AI·개발자가 이어서 작업하기 위한 문서. 마지막 갱신 2026-09-29 (보관기간·계정 삭제 반영).
이 저장소 작업 브랜치: `claude/bestchoice-miniapp-dev-ar5jtm`.

## 1. 현재 상태 한눈에
- **앱(프런트엔드) 소스가 이 저장소에 없음.** 다른 작업 환경(Claude 아님)에서 Web Framework SDK 3.x + TDS로 만들고
  `Bestchoice.ait` 빌드까지 함(테스트 45개 통과 보고). 그 소스를 이 저장소로 push 받아야 화면 작업 가능.
- 이 저장소에 있는 것: Supabase 마이그레이션, Edge Function 소스, 정책 문서 초안.
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
5. 정책 문서 초안 `docs/legal/` (개인정보처리방침, 이용약관, AI 안내). 운영자 에스케이컴퍼니/대표 박지민/문의 jmpark0611@gmail.com.
   `[확정 필요]` 표시 항목 남아 있음. 법률 자문 아님.

## 4. 남은 일 (우선순위)
사용자가 해야 할 것
- 앱 소스와 `decision-ai` 원본 소스를 이 저장소에 push (`.env` 제외)
- 검수 요청일이 정해지면 정책 문서 시행일 기입
- OpenAI 충전(실제 흐름 테스트 직전), 지출 한도·알림 설정
- 실기기에서 실제 요청 `Origin` 확인 후 `ALLOWED_ORIGINS` 등록 (추측 도메인 등록 금지)
- 토스 mTLS 인증서/키를 Supabase secrets에 직접 등록
- 앱 콘솔에 새 `.ait` 업로드, 주요 기능(`intoss://Bestchoice/input`, `/history`) 등록 후 검수 요청

코드로 할 것
- 앱 소스 수령 후: 정책 화면에 `docs/legal/` 문구 연결, AI 재시도 UI(PREVIOUS_FAILED 대신 재요청 가능), `AI_LIMIT` 안내 문구 확인,
  **'계정 삭제' 버튼** 추가(확인 다이얼로그 → `rpc('bc_delete_account')` → `auth.signOut()` → 첫 화면), 기록 화면에 "2개월 후 자동 삭제" 안내
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
  (주의: 콘솔 appName은 `Bestchoice` 대문자로 보고됨. 실제 도메인 대소문자 확인 필요)

## 6. 환경 메모
- Claude 클라우드 세션은 네트워크 정책상 `*.supabase.co`, `developers-apps-in-toss.toss.im` 직접 접속 불가. Supabase는 MCP로만 작업함.
