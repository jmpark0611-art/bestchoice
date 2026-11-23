# 결정해지니 Android 출시 준비 — 현재 결과와 남은 확인

갱신 기준: 2026-11-23 20:35 KST (11:35 UTC). Android 준비를 마친 뒤 iOS를 이어갑니다.

**전용 아이콘을 포함한 Android 후보를 실제 업로드 키로 서명·검증하여 보관했고,
실제 격리 Supabase의 기본 두 세션 흐름·신고 RPC 통합과 Android 가상기기의 네 가지
시나리오도 통과했습니다.** 서명 후보의 기기 검증,
실물 기기·운영 서버 검증, 운영 반영·Play 등록과 제출은 완료하지 않았습니다.

## 1. 실제 서명 후보와 스토어 이미지

| 항목 | 현재 확인 결과 |
| --- | --- |
| 앱 이름 | 결정해지니 |
| 앱 ID·버전 | `com.jmpark0611.genie`, versionCode `1`, versionName `1.0.0` |
| 고정된 후보 소스 | `959836f6a19bc4729d49b20237092384a2417728`의 147개 파일 |
| 새 Android 준비 기록 | 20:08:04.136 KST (`2026-11-23T11:08:04.136Z`), 앱 자산 184개·native 파일 69개 |
| 준비 기록 SHA-256 | `5888f0d28b76eec1ad59a7eaddd3fe2c2d15fe8bbaf514735b7cee2757aa9ba6` |
| unsigned 빌드 | [실행 45162298044](https://github.com/jmpark0611-art/bestchoice/actions/runs/45162298044), attempt 1, job `137650483659` 성공 |
| 서명된 전달 파일 | `Genie-Android-1.0.0-1-candidate.aab`, 4,158,468 bytes |
| 서명 AAB SHA-256 | `c737b458e8e606bd616ee5f5b8698ac6e2ca886d04c474e3a47a1a2fffddb56c` |
| 전달 확인 기록 | `Genie-Android-1.0.0-1-verification.json` |
| 스토어 아이콘 | `genie-play-icon.png`, 512×512 RGBA, 렌더 확인·보관 완료 |
| 스토어 feature graphic | `genie-play-feature.png`, 1024×500 RGB, 렌더 확인·보관 완료 |
| 상태 | `signed-awaiting-device-and-store-review` |

새 준비 사본에서 타입 검사·웹 빌드·Android 동기화·소스와 자산 대조를 마쳤고,
실제 native 빌드에서 최종 binary Manifest의 앱 ID·버전과 앱·라이브러리 자산을
대조했습니다. 전용 launcher·시작 배경·웹 SVG가 이 후보에 포함됩니다.

unsigned AAB의 SHA-256은
`bbef80c3dd9806bde081e533a0ac9f4d573c54cf130d3b8908b5f6268ba49bd8`입니다.
GitHub artifact `14810724317`의 ZIP SHA-256
`ef7cbbeaa6daa3b8d965661d225e77e817b572c3963484da1ed1224e9fc3aad6`을 독립
메타데이터와 대조해 가져온 뒤, 정확한 고정 소스와 내용 검증을 거쳐 로컬에서
서명했습니다. 비공개 서명키는 CI에 올리지 않았습니다.

로컬 서명은 인증서 지문·서명과 비서명 ZIP 항목의 바이트 보존을 확인했습니다.
서명 뒤 binary Manifest를 새로 파싱한 것은 아니며, 앞서 검증한 Manifest 바이트가
그대로임을 확인한 범위입니다. 영수증의 `binaryManifestReparsed`도 `false`입니다.
서명된 후보를 실제 기기에서 확인했거나 Play가 승인했다는 의미는 아닙니다.

## 2. 업로드 키와 실제 앱 입력

결정해지니 전용 PKCS12 업로드 키는 RSA 3072비트이며, 앞선 작은 JAR 서명 확인을
거쳐 현재 후보 AAB의 로컬 서명에도 사용했습니다. 다른 앱의 키는 사용하거나
변경하지 않았습니다. 키·접근 정보·비밀번호는 공개 문서나 소스에 넣지 않습니다.

공개 인증서 SHA-256:

```text
1f9dace46345078bcd9089be6c38b6259b83a4e2040611558c9e108eea22ea71
```

앱 입력의 공개 지문은 `ANDROID-RELEASE-PROFILE.json`에 있습니다. 실제 연결 대상은
기존 `bestchoice`의 `https://njrtcxohbkfgrgwhlvua.supabase.co`, 공유 웹 원점은
`https://genie-web-rosy.vercel.app`입니다. 빌드가 이 설정을 사용했다는 사실과 운영
서버에서 기능을 실행해 검증했다는 사실을 구분합니다. 프로필의
`actualBackendValidated`는 운영 서버 기준으로 계속 `false`입니다.

이 앱의 Play 등록·사용 가능한 패키지 ID/버전 및 새 업로드 키 등록은 아직 확인하지
않았습니다. 이미 개발자 계정과 다른 출시 앱이 있다는 사실로 이 절차가 완료됐다고
표시하지 않습니다.

## 3. 실제 격리 Supabase: 기본 흐름 통과

[실행 45163032169](https://github.com/jmpark0611-art/bestchoice/actions/runs/45163032169)는
QA 전용 후속 커밋 `2448544bb6601d4ac5154cd9bfa39722a009f248`에서 성공했고,
2026-11-23 20:13:19 KST (11:13:19 UTC)에 완료됐습니다.

- 관련 집중 검사 34개가 통과했습니다. 기존 83개 전체 앱 검사는 반복하지 않았습니다.
- 실제 로컬 Auth·PostgREST·Edge Runtime과 분리된 익명 세션 두 개를 사용했습니다.
- 합성 결정 생성, 공유, 투표 전 비공개, 투표와 집계, 작성자의 기록·삭제 흐름을 확인했습니다.
- 결정 생성은 결과가 정해진 AI fixture를 사용했습니다. 실제 모델 API를 호출하지 않았습니다.
- 실행별 소유 컨테이너·loopback listener, 외부 네트워크 차단과 폐기 자원 정리를 확인했습니다.

승인된 API 원점은 `http://127.0.0.1:55321`입니다. 이 실행은 필요할 때 소유한 임시
스택을 구성하고 정리하는 방식이며, 운영 URL이나 운영에 연결된 Preview를 테스트
서버로 취급하지 않았습니다.

이 QA 후속 커밋은 서명 AAB의 소스 커밋과 다릅니다. 검증 도구의 후속 개선을 후보
앱의 재빌드로 표시하지 않으며, 기본 격리 통과를 운영 AI·운영 데이터베이스·공유
웹까지 정상이라는 주장으로 확대하지 않습니다. 프로필에는
`isolatedBackendValidated: true`를 별도 기록했습니다.

### 신고 RPC: 실제 격리 통합 통과

[실행 45166205966](https://github.com/jmpark0611-art/bestchoice/actions/runs/45166205966),
job `137663686487`이 QA 전용 후속 소스
`fff40a925c09183cecee01ff2855f5213a04c91a`에서 성공했습니다. guard 검사 41/41과
실제 로컬 HTTP 요청을 통한 신고 검증이 통과했습니다. 결과 기록은 20:33:57.989 KST
(11:33:57.989 UTC), 정리 완료는 20:33:58.045 KST (11:33:58.045 UTC)입니다.
기본 두 세션 흐름도 이 실행에서 계속 통과했습니다. 적용한 제안 SQL의 SHA-256은
`c81db728edbc2b7584eff86d5aedc79485ba09476d35e06bfb40226d2f82024c`입니다.

| 실제 확인 항목 | 결과 |
| --- | --- |
| 접근 제한 | 합성 세션 3개로 미인증·투표 전·다른 작성자 접근 거부 확인 |
| 비공개 저장소 | HTTP private schema 접근 거부와 직접 PostgreSQL 역할 권한 거부 확인. 역할 검사 트랜잭션 rollback 확인 |
| 정상 접수 | 작성자와 투표한 방문자의 서버 접수증 확인 |
| 동시 동일 요청 | 병렬 HTTP 요청 2개가 같은 접수증 반환. 작성자 신고 행 1개, 작성자 한도 1회·전체 한도 1회만 차감 |
| 잘못된 재요청·동의 | 같은 요청의 내용 변경과 동의 누락 거부 |
| 삭제와 한도 | 원본 삭제 후 신고 행 0개, 기존 한도 기록은 유지 |
| 격리·정리 | 실제 모델·hosted Supabase·운영 파일을 사용하거나 변경하지 않음. 임시 자원 정리와 proxy 닫힘 확인 |

이 후속 변경은 QA 파일 7개에 한정되며 서명 AAB 소스나 파일을 바꾸지 않았습니다.
운영 신고 RPC 적용과 운영자의 신고 검토 절차 활성화는 별도 미완료입니다.
프로필에는 `isolatedReportingValidated: true`를 기록하고 운영 서버 검증 플래그는
계속 `false`로 유지합니다.

## 4. Android 가상기기: 네 가지 실제 실행 통과

[실행 45164565371](https://github.com/jmpark0611-art/bestchoice/actions/runs/45164565371),
job `137658074050`이 성공했고 20:25:35 KST (11:25:35 UTC)의 receipt를 확인했습니다. 환경은
API 36, Android emulator `37.3.10.0`, WebView `133.0.6943.137`입니다.

| 실제 확인 항목 | 결과 |
| --- | --- |
| 시작 | `https://localhost`에서 앱 기동 통과 |
| 시스템 뒤로가기 | 실제 OS 터치로 About 이동 후 `GLOBAL_ACTION_BACK`으로 Home 복귀 |
| 좁은 화면 | 너비 320px, scrollWidth 320, 화면 밖 요소 0, 표시된 조작 요소 18 |
| 강제종료 후 초안 | 강제종료 확인 후 재실행, 명시적 복원 동의로 A/B/note 세 필드 그대로 복원 |

`allFourCasesPassed`, `forceStopConfirmed`, `disposableAvdAndDebugKeyRemoved`가
모두 `true`이며 드라이버 guard 검사도 14/14 통과했습니다. 성공 실행이므로 실패
진단 artifact 업로드 단계는 skipped, 보관 artifact 목록은 비어 있습니다.

이 실행은 `dev.local.genie.preview` debug 앱과 격리 fixture를 사용했습니다.
소스 `d59e5d946f4ad45f8cc0dd72115bffd4ea4dbdde`가 AAB의 `959836f6…`와 다른
이유는 검증 드라이버만 후속 변경했기 때문입니다. 실행 네트워크는 loopback 범위로
제한했고 백엔드에 접속하지 않았습니다.

서명된 출시 후보의 기기 검증, 실물 기기 검증, 운영 백엔드 연결 검증은 각각
`false`입니다. 공유·투표·신고까지 포함한 전체 출시 흐름의 기기 검증으로 확장하지
않습니다. 실제 앱 화면을 담은 폰 스크린샷도 아직 제출 준비 완료로 표시하지 않습니다.

## 5. 기존 원격 작업 보호

2026-11-23 20:09:49 KST (11:09:49 UTC)의 읽기 전용 비교에서 다음을 확인했습니다.

| 보호 범위 | 결과 |
| --- | --- |
| 기존 보호 브랜치 4개 | 기존 각 HEAD와 동일 |
| `app/`, Supabase functions/migrations, `AGENTS.md`, `web/vercel.json`의 보호 대상 62개 파일 | SHA·mode 동일 |
| 운영 데이터·설정·기존 마이그레이션·기존 `vs-decide` | 이 준비 작업으로 변경하지 않음 |

변경하지 않은 브랜치 HEAD는 다음과 같습니다.

| 브랜치 | 유지한 HEAD |
| --- | --- |
| `claude/bestchoice-miniapp-dev-ar5jtm` | `470dba663677f0df7fbc3c07843b0371758b7f32` |
| `codex/genie-v7-release-candidate-20261120` | `6cb0b24748dae152e66f8f4639506dba53b618cf` |
| `codex/result-card-sharing` | `302ad90767d5bc73c65b354ff1c082bfbc8aa3c2` |
| `codex/review-remote-ai` | `1c3485bd646421a1a929c5a61109667d42817572` |

빌드·QA 전용 브랜치의 승인된 변경과 위 보호 대상을 구분합니다. 웹 배포·기존
브랜치 병합·운영 쓰기·Play 제출을 수행하지 않았고 새 유료 리소스를 만들지
않았습니다. 공개 문서에는 비공개 파일 경로, 키, URL 토큰이나 보관 서비스 내부
식별자를 넣지 않습니다.

## 6. 현재 남은 작업과 승인 범위

| 항목 | 상태·다음 결과물 |
| --- | --- |
| 서명 후보·실물 기기 확인 | 미완료. 합성 환경 검증과 구분해 결과 기록 |
| 운영 신고·서버·공유 웹 | 미검증/미반영. 검토한 운영 변경과 공유 웹 호환 확인은 별도 승인 범위 |
| 개인정보·스토어 자료 | 공개 방침, Data safety, 실제 폰 스크린샷, 심사 입력 준비. 설명·정책 초안과 아이콘·feature graphic은 확보 |
| Play 등록·업로드·심사·출시 | 미수행. 구체적인 제출 자료를 준비한 뒤 별도 승인 범위로 진행 |

필요한 도구 설치와 새 격리 검증 환경 구성은 이미 승인되어 진행했습니다. 과거의
SDK·Gradle 캐시 부재나 설치 승인 대기를 현재 AAB 미생성 차단점으로 재사용하지
않습니다. 기존 offline `android:bundle`의 도구 조건은 그대로이며, 현재 후보는
승인된 unsigned CI 빌드와 로컬 서명 경로로 확보했습니다.

상세 실행 경로는 `ANDROID-RELEASE.md`, 스토어 설명·개인정보 검토 초안은
`PLAY-STORE-PREPARATION.md`에 있습니다. 현재 결과물은 정식 출시가 끝난 앱으로
표시하지 않습니다.

## 7. 보존한 과거 준비 이력

아래 항목은 현재 상태를 덮어쓰지 않는 과거 기록입니다. JSON의 `history`에 기존
전체 snapshot을 보존했습니다.

| 과거 단계 | 당시 확인 결과 |
| --- | --- |
| 16:12:49.712 KST (07:12:49.712 UTC) 실제 입력 준비 | 소스 135개·앱 자산 183개, 준비 기록 SHA-256 `702b95d634683b929be793103d83cd775ba37084556959795c75d7a7b8c67bd3`, 당시 native 빌드 전 |
| 16:16:58 KST (07:16:58 UTC) 합성 native 검증 | 실행 `45129704040`, 커밋 `022bbd56881066c4bb12a2916dda77ad1e3a2028`, 121개 Gradle task·최종 binary Manifest·서명·자산 검증 통과, 일회용 키와 AAB 삭제 |
| 최초 로컬 도구 조건 | `ANDROID_SDK_MISSING`, `GRADLE_CACHE_MISSING`, 로컬 listener·adb 부재로 당시 단계 차단. 후속 승인 환경과 실행으로 진행 |
| 이전 집중 검사 | identity 10개, CLI 연결 5개, 로컬 통합 도구 24개. 합성·주입 검사 범위로 기록 |
| 이전 반영 보호 기록 | 당시 변경 13개·보존 223개 기록은 당시 반영 범위의 이력이며 현재 보호 대상 62개 비교와 구분 |

## 근거

- `ANDROID-RELEASE-PROFILE.json`: 변경하지 않은 실제 공개 입력·지문과 최신 완료 범위.
- `ANDROID-RELEASE-PROGRESS-2026-11-23.json`: 현재 상태, 별도 실행들의 출처, 이전 snapshot.
- `Genie-Android-1.0.0-1-verification.json`: 전달 파일과 원본 로컬 서명 영수증.
- `ANDROID-NATIVE-VERIFICATION-2026-11-23.json`: 최초 합성 native 검증 이력.
- 원본 로컬 통합 ZIP SHA-256: `df5df614b263e40ad67273d90348899693ee3099be28c874f03efa089d26387e`.
- [Android 앱 서명 공식 문서](https://developer.android.com/studio/publish/app-signing): 업로드 키와 앱 서명 키의 역할.
- [AAPT2 protobuf 스키마](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/tools/aapt2/Resources.proto): 최종 Manifest 파싱 형식.

이 문서는 위 실행 결과를 기록하며, 문서 갱신만을 위해 검증·서명을 반복하지 않았습니다.
