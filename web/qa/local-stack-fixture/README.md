# 결정해지니 일회용 로컬 통합 검증

이 폴더는 운영 Edge Function이 아닙니다. 보관된 승인 fixture를 복원해, 별도 Docker 네트워크가 실제로 검증된 뒤에만 동작하는 조건 하나를 추가했습니다. 운영 `supabase/functions/vs-decide`와 기존 마이그레이션은 수정하지 않습니다.

## 고정한 입력

- 보관 ZIP SHA-256: `2b48c6b2aa5620ed92a53eaa531bde0d194c9237a8d3406e7dd991cd235a3a62`
- 기존 스키마: `supabase/migrations/20261115000000_vs_polls_and_votes.sql`
- 스키마 SHA-256: `a11c228c811cf8f04030a6507755863a4a3c6a771f86caa5268db59c77a136f1`
- Git blob: `c2a91f8f3dfc69598907faf1109fae41be0c638a`
- Supabase CLI: `3.2.0`, 소스 commit `c3c7a586b11b6605358177efabbc1b1cb7589b23`
- CLI Linux amd64 배포본 SHA-256: `fb88b175a817563505be02c60872060bcb8d5c869a1aa5656eaeb085d4a2f1e4`
- Docker 서비스: Postgres `17.12.0.000`, GoTrue `v2.198.0`, PostgREST `v16.5`, Kong `2.8.1`, Edge Runtime `v1.79.1`.
- 격리 확인용 Node 이미지: `node:24.22.3-bookworm-slim`.

원본 파일 해시와 실행용 복사본 해시는 `manifest.json`에 구분했습니다. 실행기는 기존 스키마와 복사본 해시를 확인하고 새 임시 작업 디렉터리에 필요한 파일만 복사합니다. 마이그레이션 원문이 없는 로컬 부분 사본에서는 실행이 중단됩니다. 이미지 태그를 선행 다운로드한 뒤 실제 digest를 성공 receipt에 기록합니다. 최초 이미지 다운로드는 태그 기준이므로 배포 이미지 digest 자체가 미리 고정된 공급망 검증을 뜻하지 않습니다.

## 검증 순서와 격리

승인된 공개 저장소의 전용 브랜치, 표준 `ubuntu-24.04` GitHub runner에서만 실행됩니다. 실행기와 필요한 이미지를 내려받는 단계 이후, 모든 Supabase 컨테이너는 새 `--internal` 네트워크에 생성됩니다. API와 DB 포트는 `127.0.0.1`에만 바인딩됩니다. 원래 승인된 API 주소는 `http://127.0.0.1:55321`입니다.

Docker 내부망에서는 `-p`만으로 호스트 포트 연결을 기대하지 않습니다. 실행 프로세스가 소유하는 TCP listener 두 개가 `127.0.0.1:55322`에서 이번 DB의 내부 IP·5432로, `127.0.0.1:55321`에서 이번 Kong의 내부 IP·8000으로 연결합니다. listener를 먼저 독점 바인딩하고, 실행 nonce·project 라벨, 정확한 이미지, 실행 상태, 단일 내부 네트워크 ID와 IPv4 주소를 inspect로 확인한 뒤에만 전달합니다. 확인 전 연결, 교체된 컨테이너, 다른 주소는 거부하며 inspect가 실패하거나 컨테이너가 사라지면 기존 전달 대상도 비웁니다. CLI 시작 후에는 위 로컬 API의 `/auth/v1/health`를 GET으로 확인합니다. 이 요청은 세션이나 데이터를 만들지 않으며 외부 리다이렉트를 따라가지 않습니다. 이미 사용 중인 포트를 뺏거나 다른 프로세스를 종료하지 않습니다. 정리 시 이 프로세스의 listener와 열린 연결을 먼저 닫습니다.

호스트 전체 방화벽 정책은 바꾸지 않습니다. 새 Docker 브리지와 `172.30.240.0/24`에만 적용되는 INPUT 및 DOCKER-USER 규칙으로 컨테이너가 호스트나 다른 네트워크로 새 연결을 만드는 것을 거부합니다. CLI 전용 임시 Docker wrapper는 컨테이너 생성마다 같은 네트워크와 `--dns 127.0.0.1`을 강제합니다. Docker 내부 이름 해석은 유지하고 외부 DNS의 상위 주소를 각 컨테이너 자신의 loopback으로 제한합니다. 실제 inspect 결과도 확인합니다.

핵심 서비스 시작 후 Kong의 네트워크 namespace에서, 함수 시작 후 Edge Runtime의 namespace에서 다시 확인합니다. 내부 Kong에 연결되는지, 살아 있는 호스트 HTTP 대상과 별도 내부 네트워크의 HTTP 대상에 연결할 수 없는지 검사합니다. `.invalid` DNS 실패는 고정 DNS 설정을 보조하는 확인이며, 그 실패만으로 외부 차단을 증명하지 않습니다. 검사용 HTTP 대상은 이번 실행에서만 생성되며 운영 URL이나 모델 API에 접속하지 않습니다. fixture의 기존 허용 origin 세 개와 API 경로 목록은 넓히지 않았습니다.

첫 네트워크 검증이 완료되어야 `GENIE_EDGE_NETGUARD=docker-internal-verified` 및 이 로컬 stack에서 생성한 키를 함수 프로세스에 전달합니다. 두 번째 검증까지 완료되어야 기존 `verify-local-integration.mjs`가 두 익명 세션을 만듭니다. 실제 로컬 Auth 검증, 실제 로컬 PostgREST/RPC, 결정 저장 → 공유 → 투표 → 작성자 집계/실행 표시 → 권한 거부 → 삭제 흐름을 확인합니다. 결정 응답 자체는 합성 A/B 문자열에 한정된 결정론적 fixture입니다. 유료 모델을 호출하지 않습니다.

## 결과와 정리

정상 종료와 예외 모두 이번 실행의 라벨이 붙은 컨테이너·볼륨, 전용 네트워크, 정확히 추가한 방화벽 규칙만 삭제합니다. 복구 단계도 실행 상태 파일로 같은 범위만 처리하며 prune이나 전역 볼륨 삭제를 사용하지 않습니다. 로컬 키, 사용자 UUID와 원문 응답은 로그에 출력하지 않습니다. 키는 artifact/cache로 업로드하지 않습니다. 전용 리소스 정리가 확인되지 않으면 PASS receipt를 남기지 않습니다.

이 작업이 성공해도 운영 Supabase 검증, 모델 응답 품질 검증, Android 실기기 검증 또는 출시 완료가 아닙니다. 완전 강제 종료로 정리 단계가 실행되지 못하는 경우에는 GitHub의 일회용 runner 폐기에 의존하며 성공으로 기록하지 않습니다.

## 미배포 신고 제안의 별도 검증

기본 두 세션 흐름은 서버 QA commit `2448544bb6601d4ac5154cd9bfa39722a009f248`의 [실행 45163032169](https://github.com/jmpark0611-art/bestchoice/actions/runs/45163032169)에서 실제 통과했습니다. 그 receipt는 보존하고, 이후 실행의 신고 검증은 새 `reportingProposal` 필드로 구분합니다. 이 QA 소스의 결과를 앞서 서명한 Android AAB의 빌드 증거와 혼동하지 않습니다.

`vs-report-result.proposal.sql`은 기존 `supabase/proposals/vs-report-result.sql`의 원문을 바이트 그대로 복사한 파일입니다. 두 파일의 SHA-256은 `c81db728edbc2b7584eff86d5aedc79485ba09476d35e06bfb40226d2f82024c`입니다. 운영 마이그레이션이나 함수는 수정하지 않으며, 기존 제안의 새 객체 생성 방식과 세션 opt-in guard도 그대로 유지합니다.

실행기는 기본 흐름 성공 뒤에만 현재 nonce·project·DB container·단일 내부망 소유권을 다시 확인합니다. 정확한 DB 컨테이너의 `psql`에 stdin으로 세션 opt-in과 제안 원문을 전달하고 PostgREST 스키마를 갱신합니다. 원격 DB 주소나 SQL 본문·사용자 ID를 argv/log에 넣지 않습니다. 별도 롤백 트랜잭션에서 authenticated 역할의 직접 SELECT/INSERT 거부와 RLS·GRANT를 확인합니다. HTTP에서 비공개 스키마를 선택할 수 없다는 사실과 실제 DB 역할 권한은 구분합니다.

추가 합성 익명 세션 3개로 미투표자·다른 작성자의 신고 거부, 작성자와 투표한 친구의 접수증, 동의 누락과 요청 UUID의 내용 변경 거부를 검사합니다. 같은 요청 UUID와 내용을 실제 HTTP로 두 번 병렬 전송한 뒤 접수증 전체 일치, 신고 1건, 사용자·전체 한도 각각 1회 증가를 해당 실행의 DB 집계로 확인합니다. 이는 병렬 전송한 두 요청의 검증이며 모든 DB 스케줄이나 경쟁 상황을 강제로 재현했다는 뜻은 아닙니다.

원본 결정을 삭제한 뒤 신고는 0건이고 한도는 유지되어야 합니다. HTTP 전후와 집계 조회마다 소유권을 확인하며, 집계는 이 실행에서 생성한 poll/user/request에 한정합니다. 전체 한도는 이 실행에서 새로 생성한 비공개 스키마의 당일 카운터만 확인합니다. 최종 receipt는 이러한 검사와 기존 전용 볼륨·네트워크·listener 정리가 모두 끝난 뒤에만 출력합니다. 이 검증은 제안을 운영에 활성화하지 않습니다.

## 실행과 검증 범위

### 공유 질문 신고·작성자 차단의 추가 단계

기존 baseline과 AI 신고 증거는 유지합니다. 그 뒤 새 `vs-question-safety.proposal.sql`을 명시적인 `genie.allow_local_question_safety_proposal=on` 세션에만 적용하고, 별도 `questionSafetyProposal` receipt 필드에 검증 결과를 기록하도록 준비했습니다. 복사본은 `supabase/proposals/vs-question-safety.sql`과 바이트 동일하며 SHA-256은 `b1394b91284d6882238570afa28f2b8c8290652679cd63564ac81f651c855dba`입니다. 기존 fixture `manifest.json`을 바꾸지 않고 실행기의 별도 PINS에 새 제안을 고정합니다.

새 helper는 실제 요청 전후에 소유권을 다시 확인하고 3개 합성 세션·같은 작성자의 2개 링크만 사용합니다. 투표 전 신고와 AI 비공개 유지, 같은 UUID 두 HTTP 요청의 receipt·1행·1quota, 입력/권한 거부, 사용자 10회 한도, 투표 후 신고, 작성자 차단/해제 및 다른 링크·다른 사용자 범위, 원본 삭제 후 신고 cascade·quota/차단 유지, 삭제된 링크 때문에 막히지 않는 자기 차단 전체 해제를 검사합니다. 직접 DB 역할 검사는 별도 롤백 트랜잭션으로 처리합니다. 이 결과도 실제 CI 실행과 전용 리소스 정리가 끝나야 PASS입니다.

구버전 `vs_shared_poll`·`vs_vote`는 바뀌지 않아 개인 차단 선호를 우회할 수 있습니다. 새 클라이언트는 `_guarded` RPC를 쓰고 미설치 시 닫힌 상태로 안내해야 합니다. SQL·보관·오류·테스트 범위의 상세 계약은 `supabase/proposals/vs-question-safety.README.md`에 있습니다.

로컬 집중 검사(외부 연결 없음, proxy lifecycle 검사는 소유한 loopback echo 서버만 사용):

```sh
node --test web/scripts/local-stack-check.test.mjs web/scripts/verify-local-reporting.test.mjs web/scripts/verify-local-question-safety.test.mjs web/qa/local-stack-fixture/fixture.test.mjs
```

실제 Docker 실행은 `.github/workflows/genie-local-integration.yml`이 담당합니다. 실행 결과가 나오기 전에는 실제 Supabase 통합 통과로 표시하지 않습니다.

## 구현 근거

- [Supabase CLI 3.2.0 릴리스](https://github.com/supabase/cli/releases/tag/v3.2.0)
- [고정 CLI의 서비스 이미지 목록](https://github.com/supabase/cli/blob/c3c7a586b11b6605358177efabbc1b1cb7589b23/apps/cli/src/shared/services/Dockerfile)
- [고정 CLI Docker 생성 인자](https://github.com/supabase/cli/blob/c3c7a586b11b6605358177efabbc1b1cb7589b23/apps/cli/src/command-internal/db-bootstrap/docker-create-args.ts)
- [고정 CLI functions serve](https://github.com/supabase/cli/blob/c3c7a586b11b6605358177efabbc1b1cb7589b23/apps/cli/src/shared/functions/serve.ts)
- [고정 CLI의 host DB 준비 확인](https://github.com/supabase/cli/blob/c3c7a586b11b6605358177efabbc1b1cb7589b23/apps/cli/src/command-internal/db-bootstrap/start-database.ts)
- [고정 CLI의 오류 형식 인자 `--output-format`](https://github.com/supabase/cli/blob/c3c7a586b11b6605358177efabbc1b1cb7589b23/apps/cli/src/shared/cli/agent-output.ts)
- [Docker 내부망의 port mapping 경로](https://github.com/moby/moby/blob/v28.5.2/libnetwork/endpoint.go)
- [Docker internal network 동작](https://docs.docker.com/reference/cli/docker/network/create/#internal)
- [Docker DNS 및 network namespace](https://docs.docker.com/engine/network/)
