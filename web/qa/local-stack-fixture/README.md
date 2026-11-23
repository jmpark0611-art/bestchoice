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

## 실행과 검증 범위

로컬 집중 검사(외부 연결 없음, proxy lifecycle 검사는 소유한 loopback echo 서버만 사용):

```sh
node --test web/scripts/local-stack-check.test.mjs web/qa/local-stack-fixture/fixture.test.mjs
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
