# 공유 질문 신고·작성자 차단 — 로컬 제안

이 파일은 **미배포 SQL 제안**입니다. 운영 마이그레이션, 기존 `vs_*` 함수·테이블, `vs-decide`, AI 결과 신고 제안을 수정하거나 적용하지 않습니다. 승인된 일회용 로컬 DB에서만 별도 세션 opt-in을 사용합니다.

- 원본: `supabase/proposals/vs-question-safety.sql`
- 실행용 바이트 동일 복사본: `web/qa/local-stack-fixture/vs-question-safety.proposal.sql`
- 두 파일 SHA-256: `b1394b91284d6882238570afa28f2b8c8290652679cd63564ac81f651c855dba`
- 새 세션 opt-in: `set genie.allow_local_question_safety_proposal = 'on';`
- 기존 보관 fixture의 `manifest.json`과 원본 해시는 바꾸지 않습니다. 새 제안은 실행기 `PINS.questionSafetyProposalSha256`에 따로 고정했습니다.

## 새 클라이언트 계약

| RPC | 입력 | 성공 응답 |
|---|---|---|
| `vs_report_question` | `p_request_id uuid`, `p_category text`, `p_details text`, `p_consent boolean`, `p_share_code text` | `{status:'received', receiptId, requestId, receivedAt}` |
| `vs_set_question_author_block` | `p_share_code text`, `p_blocked boolean` | `{status:'blocked'}` 또는 `{status:'unblocked'}` |
| `vs_clear_question_author_blocks` | 없음 | `{status:'cleared'}` |
| `vs_shared_poll_guarded` | `p_code text` | 차단하지 않았다면 기존 `vs_shared_poll`의 JSON |
| `vs_vote_guarded` | `p_code text`, `p_choice text` | 차단하지 않았다면 기존 `vs_vote`의 JSON |

새 public RPC는 invoker wrapper이고 실제 구현은 새 `genie_question_safety_private` 스키마의 빈 `search_path` definer 함수입니다. `auth.uid()` 확인을 우회할 수 없도록 private 함수 자체에도 인증을 적용합니다. `anon`과 PUBLIC의 실행 권한을 회수하고 `authenticated`만 공개 계약을 호출할 수 있습니다. 내부 guard 함수는 일반 클라이언트 실행을 허용하지 않습니다.

### 공유 질문 신고

유효한 공유 코드로 이미 표시되는 질문은 **투표 전·후 모두 비작성자가 신고**할 수 있습니다. 서버는 공유 코드로 원본 poll과 권한을 확인하며 클라이언트가 보낸 작성자 ID를 믿거나 요구하지 않습니다. AI 선택·이유·투표 집계·작성자 UUID를 접수 응답에 넣지 않습니다. 본인이 작성한 질문 또는 사라진/알 수 없는 링크는 `REPORT_NOT_ALLOWED/42501`로 거부합니다.

기존 신고 UI와 같은 `unsafe`, `incorrect`, `privacy`, `other` 분류를 받습니다. 세부 설명은 trim 후 최대 200자·UTF-8 800bytes, 동의는 정확히 true여야 합니다. 질문·AI 본문을 복제하지 않고 원본 poll 참조, 신고 분류·선택 설명, 신고자, 동의 버전 `question-report-v1`, 서버 접수 시각·ID만 private 영역에 저장합니다.

신고자와 요청 UUID에 유일 제약을 두고 신고자별 advisory transaction lock으로 재전송을 직렬화합니다. 같은 UUID·같은 poll/분류/정리된 설명이면 같은 접수증을 반환하고 quota를 다시 쓰지 않습니다. 다른 payload는 `REPORT_REQUEST_CONFLICT/22023`, 동의 또는 입력 불량은 `REPORT_INVALID/22023`입니다. 새 접수는 사용자당 UTC 하루 10건, 전체 500건이며 각각 `REPORT_LIMIT/P0001`, `REPORT_BUSY/P0001`로 거부합니다. 실패는 접수나 한도를 남기지 않습니다.

### 작성자 차단과 해제

차단은 `auth.uid()`인 현재 사용자와 DB가 공유 코드로 찾은 작성자의 쌍을 private 테이블에 저장합니다. 두 사용자 UUID를 API로 반환하지 않습니다. 같은 작성자의 다른 링크에도 적용하고 차단·해제를 반복해도 중복 행이 생기지 않습니다.

- 자신의 글을 통해 자신을 차단하면 `BLOCK_SELF_NOT_ALLOWED/42501`입니다.
- 입력 불량은 `BLOCK_INVALID/22023`, 없는 링크는 `BLOCK_NOT_ALLOWED/42501`입니다.
- 한 사용자당 200명까지 차단하며 추가 작성자는 `BLOCK_LIMIT/P0001`입니다. 기존 차단을 반복하는 것은 cap에서도 성공합니다.
- 원래 링크가 있으면 그 링크에서 해제할 수 있습니다. 링크가 삭제되어도 `vs_clear_question_author_blocks()`로 **현재 사용자의 모든 차단만** 해제할 수 있습니다.
- 다른 사용자의 차단은 그대로 남습니다. 서버에 차단 목록이나 작성자 ID 조회 API를 추가하지 않습니다.

새 guarded RPC는 차단된 작성자일 때 `AUTHOR_BLOCKED/42501`로 거부하며 질문이나 AI 결과를 반환하지 않고 표를 쓰지 않습니다. 차단하지 않은 경우 원래 RPC의 응답·작성자 구분·투표 권한·한 표 동작을 그대로 사용합니다. 없는 링크는 원래 `NOT_FOUND/P0002`입니다.

차단 변경과 새 guarded 요청은 같은 현재 사용자별 advisory lock을 사용합니다. guard가 먼저 KEY SHARE를 잡은 뒤 기존 vote가 FOR UPDATE로 올리는 방식을 피했습니다. 두 사용자의 동시 투표가 서로 행 잠금 상승을 기다리는 새 교착을 만들지 않도록 기존 `vs_vote`의 행 잠금에 위임합니다.

**기존 `vs_shared_poll`과 `vs_vote`는 그대로 남습니다.** 따라서 구버전 또는 직접 호출 클라이언트는 이 개인 선호 제어를 우회할 수 있습니다. 차단은 새 클라이언트의 표시·투표 경로에 적용되는 기능이며 데이터 접근 권한 전체를 대체하지 않습니다. 새 클라이언트는 guarded RPC가 없을 때 기존 RPC로 fallback하지 않고 공유 기능을 일시적으로 사용할 수 없다고 알려야 합니다. 계정/기기의 익명 세션이 달라지면 같은 사용자로 자동 복구되는 기능은 추가하지 않았습니다.

## 데이터 권한과 삭제

`question_reports`, `author_blocks`, `user_daily_limits`, `daily_limits` 모두 RLS를 켜고 클라이언트의 직접 SELECT·INSERT·UPDATE·DELETE·TRUNCATE·REFERENCES·TRIGGER를 회수합니다. 클라이언트 정책은 만들지 않습니다. 비공개 스키마가 HTTP에 노출되지 않는 사실과 실제 PostgreSQL 역할 권한은 각각 검사합니다.

원본 poll 삭제는 질문 신고를 cascade 삭제하지만 사용자·전체 일별 한도는 되돌리지 않습니다. 차단은 poll에 FK를 걸지 않으므로 다른 링크에도 계속 적용됩니다. 사용자 계정이 실제 삭제되는 경우 해당 사용자의 신고·사용자 한도·차단 쌍은 FK로 삭제되고 전체 한도는 남습니다. 이 제안에 계정 삭제 API를 추가한 것은 아닙니다.

신고는 원본 poll의 수명을 따릅니다. 기존 2개월 poll 정리 함수가 원본을 삭제하면 신고도 삭제됩니다. 한도 기록은 성공한 새 신고 요청에서 7일보다 오래된 것을 정리하며 cron을 변경하지 않습니다. 차단은 사용자의 해제 또는 관련 Auth 사용자 삭제 때까지 유지됩니다.

관리자 UI, 별도 사용자 검색, 신고 목록의 클라이언트 조회, 자동 제재·검열, 외부 통보 또는 유료 API를 추가하지 않았습니다. 실제 운영 신고를 처리하는 담당자와 운영 절차는 이 SQL 적용과 별도로 정해야 합니다.

## 완료한 로컬 확인과 제한

새 SQL만 대상으로 이미 설치되어 있던 PGlite 0.5.17의 PostgreSQL 18.7 WASM, Node 24.22.3에서 **11개 검사 그룹을 통과**했습니다. canonical SQL은 의존 스키마로 읽었고 기존 83개 앱 검사나 기존 신고 SQL 검사 20그룹은 반복하지 않았습니다.

검사한 내용은 session opt-in, 원문 컴파일, RLS/GRANT/실제 역할 SELECT·INSERT 거부와 롤백, 인증·자기 신고·알 수 없는 링크 거부, 투표 전 receipt와 AI 비공개 유지, retry·충돌·동의·입력 길이, 10/500 신고 경계, 차단·해제·다른 링크·다른 사용자 범위, 원본 삭제 cascade·quota 유지, 200 차단 경계와 clear, Auth FK cascade, 기존 함수 본문 불변입니다.

별도 HTTP helper는 주입 transport로 **7개 검사**를 통과했습니다. 잘못된 개인정보 응답, 중복 quota, 차단된 read/write, 다른 사용자 차단 해제, 삭제 시 quota 환급/차단 소실, 병렬 요청 실패 후 늦은 요청보다 먼저 정리하는 경우를 실패로 처리합니다. runtime의 변경된 provenance·설치 gate·실패 정리·receipt 순서 **5개 검사**도 통과했습니다.

PGlite는 단일 연결의 합성 `auth.uid()`이며 실제 Auth/JWT/PostgREST 또는 동시 다중 DB 세션 검증이 아닙니다. 로컬 WASM PostgreSQL 18.7과 일회용 Docker PostgreSQL 17.12의 버전도 다릅니다. 실제 Docker HTTP 검증은 root가 승인된 CI에서 실행한 후에만 통과로 기록합니다.

## 준비된 실제 격리 검증

기존 일회용 Docker stack의 baseline과 AI 신고 검증을 약화하지 않고, 그 뒤에 새 단계만 추가합니다. 각 HTTP 요청 전후와 count audit 직전에 실행 nonce·project·DB 컨테이너·단일 내부망 소유권을 확인합니다. 정확한 로컬 DB 컨테이너의 psql stdin에 opt-in과 고정된 제안 원문을 전달하며 SQL·키·사용자 ID를 argv/log에 넣지 않습니다.

새 3개 합성 익명 세션과 같은 작성자의 2개 질문으로 다음을 확인하도록 준비했습니다.

1. 신규 5개 RPC의 익명 실행 거부와 private 스키마 HTTP 차단, 실제 DB 역할 직접 SELECT/INSERT 거부.
2. 투표 전 신고 접수 후에도 AI 선택·이유·집계가 숨겨져 있고 자기/알 수 없는 링크 신고는 거부되는지.
3. 같은 UUID·내용으로 실제 HTTP 요청 두 개를 병렬 전송하여 같은 접수증, 신고 1건, 사용자·전체 quota 각각 1회인지.
4. 변경 payload·동의 거부, 투표 후 신고, 10회 경계, cap에서 같은 요청의 재전송인지.
5. 차단/해제 idempotency, 같은 작성자의 다른 링크 차단, 다른 사용자에게 영향 없음, 차단된 투표의 무쓰기.
6. 원본 삭제 후 신고는 삭제되고 quota·작성자 차단은 유지되는지, 링크 삭제 후 clear가 자기 차단만 해제하는지.

새 결과는 기존 baseline/report receipt를 대체하지 않고 `questionSafetyProposal` 필드에만 기록합니다. 실제 HTTP는 사용자 10회 경계를 검사하지만 500 global/200 blocks 경계는 로컬 WASM 검사로 구분합니다. 병렬 HTTP 두 건의 결과를 모든 DB 경쟁 일정의 증명이라고 표시하지 않습니다. 실패 시 poll 정리는 best effort이며 성공 receipt는 기존 전용 컨테이너·볼륨·네트워크·listener 정리까지 성공한 뒤에만 출력합니다.
