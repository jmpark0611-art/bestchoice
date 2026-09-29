# Supabase (project `njrtcxohbkfgrgwhlvua`, 서울)

## 마이그레이션
| 파일 | 원격 기록 | 내용 |
|---|---|---|
| `20260926043902_init_bestchoice_schema.sql` | 있음 | 뽑기/투표: profiles, decisions, options, votes, 공유·투표 RPC |
| `20260926043926_index_composite_fks.sql` | 있음 | 복합 FK 인덱스 |
| `20260927110000_bc_ai_decision_schema.sql` | **없음** | AI 판단 보조 `bc_*` 스키마. 원격에 직접 적용돼 있던 것을 카탈로그에서 역추출 |

세 파일은 빈 Postgres 16에 순서대로 적용되며(auth 스텁 사용), `bc_*` 흐름(생성→clarify→analyze→실제 선택→전체 삭제)이 동작하는 것을 확인함.
원격 기록 정합: `supabase migration repair --status applied 20260927110000` (원격에 재적용 금지).

## Edge Functions
- `decision-ai` (v8, verify_jwt=false, 함수 내부에서 토큰 검증): 배포 번들을 그대로 보관. 원본 소스 수령 시 교체.
  secrets: `OPENAI_API_KEY`, `OPENAI_MODEL`, `ALLOWED_ORIGINS`
- `toss-mtls-test`: mTLS 확인용, 확인 후 삭제. secrets: `TOSS_MTLS_CERT`, `TOSS_MTLS_KEY`

## 로컬 검증으로 확인된 문제 (미수정, 결정 필요)
1. **AI 실패 후 재시도 불가**: `bc_finish_ai`가 실패 시 요청을 `failed`로 남기고, `bc_claim_ai`는 기존 요청이 있으면 그 상태만 돌려줌.
   → 같은 결정은 영구히 `PREVIOUS_FAILED`. OpenAI 429/타임아웃 한 번이면 사용자는 고민을 새로 작성해야 하고 일일 작성 한도(20)도 소모됨.
2. **AI 일일 한도 100회가 전체 사용자 공용**(`bc_ai_limits`는 날짜만 키). 사용자당 작성 20건 × 2단계라 소수 사용자가 서비스 전체 AI를 막을 수 있음.
3. **삭제 후 tombstone(결정 id, 사용자 id) 영구 보관**: 정리 주기 없음. 개인정보처리방침 2항과 맞춰야 함.
4. 자동 보관기간 만료 삭제 없음.
