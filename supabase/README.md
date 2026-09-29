# Supabase (project `njrtcxohbkfgrgwhlvua`, 서울)

## 마이그레이션
| 파일 | 원격 기록 | 내용 |
|---|---|---|
| `20260926043902_init_bestchoice_schema.sql` | 있음 | 뽑기/투표: profiles, decisions, options, votes, 공유·투표 RPC |
| `20260926043926_index_composite_fks.sql` | 있음 | 복합 FK 인덱스 |
| `20260927110000_bc_ai_decision_schema.sql` | **없음** | AI 판단 보조 `bc_*` 스키마. 원격에 직접 적용돼 있던 것을 카탈로그에서 역추출 |
| `20260929051831_bc_ai_retry_and_user_limit.sql` | 있음 | AI 실패/중단 후 재시도 허용, 사용자별 AI 일일 한도(10회) |
| `20260929093527_bc_retention_and_account_delete.sql` | 있음 | 2개월 보관 후 자동 삭제(pg_cron), 앱 내 계정 삭제 RPC |

세 파일은 빈 Postgres 16에 순서대로 적용되며(auth 스텁 사용), `bc_*` 흐름(생성→clarify→analyze→실제 선택→전체 삭제)이 동작하는 것을 확인함.
원격 기록 정합: `supabase migration repair --status applied 20260927110000` (원격에 재적용 금지).

## Edge Functions
- `decision-ai` (v8, verify_jwt=false, 함수 내부에서 토큰 검증): 배포 번들을 그대로 보관. 원본 소스 수령 시 교체.
  secrets: `OPENAI_API_KEY`, `OPENAI_MODEL`, `ALLOWED_ORIGINS`
- `toss-mtls-test`: mTLS 확인용, 확인 후 삭제. secrets: `TOSS_MTLS_CERT`, `TOSS_MTLS_KEY`

## AI 호출 규칙 (bc_claim_ai, 2026-09-29 수정 후)
- 단계(clarify/analyze)마다 요청 1행. `done`이면 저장된 결과 반환, `running`이면 IN_PROGRESS.
- `failed` 이거나 `running`이 2분 초과면 **재시도 허용**: 새 request_id/hash로 행 초기화, 결정 상태를 `draft`/`analyzing`으로 복구. 이전 시도의 늦은 finish는 request_id 불일치로 무시됨.
- 한도: 사용자당 하루 10회(`bc_ai_user_limits`, 초과 시 `AI_LIMIT_USER`) + 전체 하루 100회(`bc_ai_limits`, `AI_LIMIT`). 재시도도 1회로 셈. 초과 예외 시 두 카운터 모두 롤백.
- decision-ai는 에러 메시지에 `AI_LIMIT` 포함 여부로 매핑하므로 두 한도 모두 클라이언트에는 `AI_LIMIT`로 감. 함수 수정 불필요.
- 한도 값은 함수 안 상수(10, 100). 바꾸려면 새 마이그레이션으로 `bc_claim_ai` 교체.

## 보관기간·계정 삭제 (2026-09-29 사용자 결정)
- `bc_purge_expired()`: pg_cron `bc-purge-expired`가 매일 18:00 UTC(03:00 KST) 실행.
  작성 2개월 지난 결정(하위 데이터 cascade)과 2개월 지난 tombstone 삭제, 7일 지난 한도 카운터 삭제.
- `bc_delete_account()` (authenticated): 본인 auth.users 삭제 → bc_users, profiles 이하 모두 cascade.
  클라이언트는 호출 성공 후 `supabase.auth.signOut()` 하고 첫 화면으로 보낼 것(기존 토큰은 만료까지 남지만 사용자 행이 없어 쓰기 불가).

## 남은 문제
1. 성능 advisor INFO: `bc_analytics_events`(user_id, decision_id), `bc_decision_request_tombstones`(user_id) FK 인덱스 없음. 데이터 적을 때는 무시 가능.
2. 기록이 없어도 익명 auth 사용자 행은 남음(식별자만). 필요하면 장기 미접속 익명 계정 정리 추가.
