# 운영 적용 재개 결과 — 2026-11-24

**상태: 사용자 재개 승인 완료, 실행 연결 문제로 운영 미반영.**

사용자의 “그렇게 계속 진행하자.”에 따라 취소됐던 신고·차단 migration 적용을 재개했습니다. 추가 사업적 승인을 기다리는 상태가 아닙니다.

## 실제 실행과 확인

첫 AI 결과 신고 migration 요청을 기다리는 동안 실행 환경이 교체되어 완료 응답을 받지 못했습니다. 읽기 전용으로 신규 schema·RPC·이력이 없음을 확인하고, 저장된 SQL 두 파일의 SHA-256을 검증한 뒤 동일한 첫 migration을 한 차례 재시도했습니다. 이 요청도 실행 환경 교체로 완료 응답을 받지 못했습니다. 질문 신고·작성자 차단 migration은 요청하지 않았고, 같은 쓰기 요청을 더 반복하지 않았습니다.

**2026-11-24 23:06:42 한국시간**의 실제 서버 관측은 다음과 같습니다.

- 기존 migration 7개. 새 적용 이력 없음.
- `genie_reporting_private`, `genie_question_safety_private` 없음.
- 새 공개 RPC 6개 모두 없음.
- 실제 사용자 행을 읽거나 테스트 사용자·질문·투표·신고 데이터를 만들지 않음.

완료 응답이 없다는 사실과 현재 catalog에서 미반영으로 관측됐다는 사실을 구분합니다. 실행 환경을 잃은 외부 요청의 상태를 가정해 재전송하면 안 됩니다. 재개할 때 다시 이력과 이름 충돌을 읽어야 합니다. SQL 오류나 자동 승인 검토의 거절이 반환된 것은 아닙니다.

구조화한 근거: [재개 실행 기록](production-server-resume-2026-11-24.json).

## 준비된 변경안은 보존

| 변경 | 실행 대기 파일 | SHA-256 |
| --- | --- | --- |
| AI 결과 신고 | `supabase/release-prep/cli-generated/20261123161249_genie_result_reporting.sql` | `92d40ba68d582bd442ff8d0b3b7d2b70759a2b7b0bf9c3d5fe8f7ad1516a89b6` |
| 질문 신고·작성자 차단 | `supabase/release-prep/cli-generated/20261123161257_genie_question_safety.sql` | `fc424dadada0dfd074b39dfb12c835adc58ad9880d0637e6370844f4513c9698` |

두 파일은 실제 CLI 생성본이며, runner가 transaction과 migration history를 함께 관리하도록 검토됐습니다. 기존 국소 검사 8개 통과 근거와 적용 후 catalog 검증 자료도 있습니다. 기존 전체 테스트·격리 HTTP 검사·앱 빌드·ZIP 생성을 반복하지 않았습니다.

## Android 접속 설정의 별도 차단

Supabase secret을 읽거나 바꾸는 연결 도구가 없으며, 브라우저 연결도 “originating browser context”가 없어 실패했습니다. 클라우드 브라우저 도구도 현재 사용할 수 없습니다. 로그인·secret 값 조회·CORS 변경은 수행하지 않았습니다.

기존 유효 `VS_ALLOWED_ORIGINS`를 먼저 확인하고 모든 기존 항목을 보존하며 정확히 `https://localhost`만 추가해야 합니다. 마지막 실제 OPTIONS 근거는 11월 23일의 Android 403 / 기존 웹 204이며, 현재 결과로 갱신한 것이 아닙니다.

## 재개에 필요한 것

필요한 것은 같은 승인 재요청이 아니라 **정상 동작하는 실행 연결과 Supabase 관리 화면 접근**입니다. 연결이 복구되면 기존 승인을 유지한 채 현재 이력·충돌 확인 → 첫 migration 적용과 실제 version 확인 → 두 번째 migration 적용 → 권한·RLS·기존 함수 보존과 advisors 확인 순서로 이어갑니다. 일반 SQL 실행으로 migration 기록을 우회하거나 기존 함수를 덮어쓰지 않습니다.

현재 Android 후보는 `Genie-Android-1.0.0-1-20261124-candidate.aab` / SHA-256 `5fbf088745564bbe32343a485a2b316f130ba9668c529a25a48f17f557256e78`이며 그대로 보존했습니다. 운영 기능·정확한 서명 후보의 실기기 확인·스토어 제출 완료로 표시하지 않습니다.
