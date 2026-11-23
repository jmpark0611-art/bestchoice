# 결정해지니 Android 출시 준비

이 문서는 Android 출시 경로와 검증 이력을 설명합니다. **2026-11-23 현재 전용
아이콘을 포함한 실제 설정의 AAB를 생성하고, 결정해지니 전용 업로드 키로 로컬
서명·검증하여 보관했습니다.** Google Play 제출을 마쳤다는 의미는 아닙니다.

## 현재 준비 상태 — 2026-11-23 20:35 KST (11:35 UTC) 갱신

| 항목 | 현재 결과 |
| --- | --- |
| 실제 앱 ID·버전 | `com.jmpark0611.genie`, versionCode `1`, versionName `1.0.0` |
| 후보의 고정 소스 | 147개 파일, `959836f6a19bc4729d49b20237092384a2417728` |
| unsigned 빌드·자산·최종 Manifest 검증 | [실행 45162298044](https://github.com/jmpark0611-art/bestchoice/actions/runs/45162298044), attempt 1, job `137650483659` 통과 |
| 로컬 서명 후보 | `Genie-Android-1.0.0-1-candidate.aab`, 4,158,468 bytes |
| 서명 후보 SHA-256 | `c737b458e8e606bd616ee5f5b8698ac6e2ca886d04c474e3a47a1a2fffddb56c` |
| 전달 확인 기록 | `Genie-Android-1.0.0-1-verification.json` — 서명 검증, 원본 payload 보존, `brandingIncluded: true`, `storeSubmitted: false` |
| 브랜드·스토어 이미지 | 전용 Android launcher·시작 배경·웹 SVG가 후보에 포함됨. 별도 `genie-play-icon.png` 512×512 RGBA와 `genie-play-feature.png` 1024×500 RGB 렌더 확인·보관 완료 |
| 실제 격리 Supabase 기본 흐름 | [실행 45163032169](https://github.com/jmpark0611-art/bestchoice/actions/runs/45163032169), QA 전용 후속 커밋 `2448544bb6601d4ac5154cd9bfa39722a009f248` 통과 |
| 실제 격리 신고 RPC | [실행 45166205966](https://github.com/jmpark0611-art/bestchoice/actions/runs/45166205966), QA 전용 후속 커밋 `fff40a925c09183cecee01ff2855f5213a04c91a`의 실제 HTTP·접근 권한·동시 동일 요청·삭제 검증과 guard 41/41 통과 |
| Android 가상기기 | [실행 45164565371](https://github.com/jmpark0611-art/bestchoice/actions/runs/45164565371), QA 드라이버 후속 커밋 `d59e5d946f4ad45f8cc0dd72115bffd4ea4dbdde`에서 네 가지 preview fixture 시나리오 통과 |
| 미완료 | 서명 후보·실물 기기 검증, 실제 운영 서버·신고 운영·공유 웹 호환, 개인정보 공개와 스토어 준비·제출은 별도 |

AAB와 확인 JSON, 두 스토어 PNG는 `deliverables/genie-android-release/` 전달 폴더에
정리했습니다. 고정 소스의 unsigned AAB는 GitHub artifact의 ZIP 해시와 출처를
독립 확인한 뒤 로컬로 가져왔으며, 비공개 서명키는 CI에 올리지 않았습니다.
서명 후 비서명 ZIP 항목과 Manifest가 원본과 같다는 것을 확인했습니다. 이 단계는
binary Manifest를 다시 파싱한 검사가 아니라 앞서 확인한 Manifest 바이트의 보존
검사이며, 확인 JSON도 `binaryManifestReparsed: false`로 구분합니다.

기본 Supabase 통과 기록은 실제 로컬 Auth·PostgREST·Edge Runtime과 합성 데이터로
확인한 별도 QA 결과입니다. AAB에 포함된 소스 커밋을 QA 후속 커밋으로 바꾸어
표시하지 않으며, 운영 OpenAI 호출이나 운영 서버 검증으로 계산하지 않습니다.
최신 세부 상태는 `ANDROID-RELEASE-PROGRESS-2026-11-23.md`, 스토어·개인정보 초안은
`PLAY-STORE-PREPARATION.md`를 참고합니다. 아래의 최초 합성 검증과 환경 차단 기록은
과거 이력으로 보존합니다.

실제 연결 대상과 앱 등록 전 후보 입력을
`ANDROID-RELEASE-PROFILE.json`에 기록했습니다. 앱 ID는 `com.jmpark0611.genie`,
첫 버전은 `1.0.0`(versionCode 1)입니다. 이 ID의 Play 등록·사용 가능 여부를
확인했다는 의미는 아니며, 최초 스토어 업로드 전에는 변경할 수 있는 준비값입니다.
해당 서버의 활성 공개 키와 생성·검증한 업로드 서명키는 소스 밖에서 관리합니다.

## 실행 명령

`web` 폴더에서 실행합니다. 설치된 의존성을 사용하며 자동 설치는 하지 않습니다.

| 명령 | 하는 일 | 성공해도 남는 확인 |
| --- | --- | --- |
| `npm run android:check` | 명시한 공개 설정의 형식, 로컬 JDK 도구·SDK 파일·Gradle 배포 캐시·서명 입력의 존재를 읽기 전용으로 확인 | 도구 버전 호환성, 전체 Gradle/Maven 캐시, 키 비밀번호·소유권, 서버 동작 |
| `npm run android:prepare` | 타입 검사, 새 웹 빌드, 별도 사본에서 Android만 동기화, 소스·설정·복사 파일 대조 | 네이티브 컴파일, AAB 서명, 실제 서버 및 실기기 |
| `npm run android:bundle` | 네이티브 준비 조건을 먼저 확인한 뒤 새로 `prepare`하고, 캐시된 Gradle로 AAB 생성, 서명 및 최종 Manifest 앱 ID·버전 검증 시도 | 실제 기기, Play Console 검토, 제출·출시 |
| `npm run test:android-release` | 새 출시 경로의 설정 검증·파일 일치·중단 동작을 로컬에서 확인 | 모의 실행 테스트는 실제 Gradle 컴파일·서명 검증을 대신하지 않음 |

`prepare`는 JDK, Android SDK 또는 서명키가 없어도 공개 설정과 기존 웹 의존성이
준비되어 있으면 실행할 수 있습니다. `check`와 `bundle`은 네이티브 준비 조건까지
요구합니다. `bundle`은 이전 `prepare` 결과나 기존 AAB를 재사용하지 않습니다.

### 현재 후보를 만든 별도 경로

기존 offline `android:bundle`과 함께, 승인된 공개 저장소의 표준 Linux 실행기에서
unsigned AAB를 만든 뒤 로컬 서명하는 경로를 사용했습니다.

1. `scripts/android-public-config.mjs`가 승인된 기존 공개 웹에서 공개 설정을 읽고
   알려진 지문과 대조했습니다. 서버·모델 API를 호출하거나 앱을 실행하지 않았습니다.
2. `scripts/android-unsigned-export.mjs`가 명시적 다운로드 허용 아래 새 사본을
   준비하고 unsigned 빌드, 최종 Manifest, 앱·라이브러리 자산, 소스 일치를 확인했습니다.
   서명 환경 변수는 받지 않으며, helper 자체에는 업로드 기능이 없습니다.
3. 별도 승인된 export workflow가 AAB·identity 기록·준비 기록·export 기록의 정확한
   네 파일을 하루 보관 artifact로 전달했습니다. 현재 전달 artifact는 `14810724317`,
   ZIP SHA-256은 `ef7cbbeaa6daa3b8d965661d225e77e817b572c3963484da1ed1224e9fc3aad6`입니다.
4. `scripts/sign-android-export.mjs`가 독립 조회한 실행 메타데이터·ZIP 해시, 정확한
   로컬 소스 사본, 공개 설정 지문·최종 identity·자산을 확인한 뒤에만 비공개 로컬
   입력으로 서명했습니다. 인증서 지문, 서명, 원본 payload 보존을 확인하고 별도
   서명 영수증을 남겼습니다.

따라서 초기 작업 공간의 SDK·Gradle 캐시 부재는 **현재 후보 파일이 없다는 차단점은
아닙니다.** 이것이 그 작업 공간에서 offline native 빌드를 실행했다는 뜻은 아니며,
해당 명령의 기존 도구 조건은 아래와 같이 유지됩니다.

## 명시해야 하는 공개 설정 여섯 가지

빈 이름표는 `.env.android-release.example`에 있습니다. **어떤 `.env` 파일도 자동으로
읽지 않습니다.** 승인된 로컬 셸이나 비공개 CI 환경에서 아래 값을 환경 변수로
주입해야 합니다. 예제 파일을 복사하는 것만으로 설정이 적용되지는 않습니다.

| 환경 변수 | 용도와 제한 |
| --- | --- |
| `GENIE_ANDROID_APPLICATION_ID` | 이 앱에 사용할 확정 패키지 ID. 소문자 점 구분 형식이며 Preview·test·example 등 자리표시자 구간과 `dev.local` ID는 거부 |
| `GENIE_ANDROID_VERSION_CODE` | 1~2100000000 정수. 공백·앞자리 0 불가. 기존 앱 갱신이라면 해당 앱에서 사용한 값보다 높아야 하는지는 별도로 확인 |
| `GENIE_ANDROID_VERSION_NAME` | 사용자에게 표시할 1~40자 버전. 공백과 Preview·Test 문구 불가 |
| `VITE_SUPABASE_URL` | 승인된 서버의 HTTPS 원점. 경로·인증정보·쿼리·IP·로컬/예제 도메인 불가 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 해당 서버의 `sb_publishable_` 공개 키. 비공개 키, 자리표시자 및 이전 JWT 형식 키는 이 경로에서 거부 |
| `VITE_PUBLIC_APP_URL` | 공유 투표 링크를 열 실제 HTTPS 웹 원점. 앱 내부 주소나 로컬 주소로 대신하지 않음 |

앱 표시는 `결정해지니`로 고정합니다. URL과 키 검사는 형식 검사입니다. 서버의
소유권·접속 가능 여부, 키가 해당 프로젝트에 속하는지, 서비스가 운영용인지까지
증명하지 않습니다. 기존 `.env.example`에 있는 주소를 자동으로 채택하지 않습니다.

승인된 세 개 외에 다른 `VITE_` 환경 변수가 있으면 중단합니다. Vite는 환경 파일
자동 읽기를 끈 상태에서 세 공개 값을 명시적으로 번들에 반영합니다. 웹 빌드와
Capacitor 자식 프로세스에는 서명 정보나 무관한 서비스 비밀값을 전달하지 않습니다.

## Offline AAB 생성 경로의 비공개 서명 입력

| 환경 변수 | 의미 |
| --- | --- |
| `GENIE_ANDROID_KEYSTORE_PATH` | 읽을 수 있는 출시 키 저장소의 절대 경로 |
| `GENIE_ANDROID_KEYSTORE_PASSWORD` | 키 저장소 비밀번호 |
| `GENIE_ANDROID_KEY_ALIAS` | 사용할 키 별칭 |
| `GENIE_ANDROID_KEY_PASSWORD` | 해당 키 비밀번호 |

이 값은 로컬의 비공개 환경에서 설정합니다. 비밀번호나 키 파일을 대화, 소스,
명령행 인수 또는 배포 ZIP에 넣지 않습니다. `debug.keystore`와 `androiddebugkey`
별칭은 거부하며, 서명 정보가 없으면 디버그 키로 대체하지 않습니다. Gradle의
설정 캐시를 끄고, 새로 생성된 AAB에 대한 `jarsigner` 결과가 확인되어야 생성 완료로
표시합니다. 서명 성공은 Play 계정의 승인이나 업로드 키 등록 상태를 보장하지 않습니다.

2026-11-23에는 결정해지니 전용 RSA 3072비트 업로드 키를 생성하고, 별도의 작은
JAR에 실제 서명한 뒤 `jarsigner` 검증을 마쳤습니다. 키 저장소·접근 정보·공개 인증서·
생성 기록을 비공개로 보관했습니다. 당시에는 새 키를 출시 AAB에 쓰지 않았지만,
후속 작업에서 위의 실제 후보 AAB에 로컬 서명하고 검증했습니다. 기존 앱의 키를
사용하거나 변경하지 않았으며, 새 키의 Play 등록은 아직 확인하지 않았습니다.
공개 인증서 SHA-256은 `ANDROID-RELEASE-PROFILE.json`에서 확인할 수 있습니다.

unsigned import·로컬 서명 경로에서는 명시한 비공개 접근 JSON과 키 저장소를
사용합니다. 이 문서에 비공개 경로나 값을 기재하지 않으며, 파일·출처·내용 검증을
마치기 전에 서명 입력을 읽지 않습니다. 두 경로 모두 서명 성공과 Play 등록 상태는
구분합니다.

## Offline 빌드에 준비되어 있어야 하는 도구

현재 소스는 Android SDK 36(최소 SDK 24), AGP 8.13.0, Gradle 8.14.3의 `all`
배포본, Java 21 컴파일 설정을 사용합니다. AGP 8.13.0의 기본 Build Tools는
35.0.0입니다. 이번 변경에서 이 버전을 바꾸지 않았습니다.

자동 AAB 생성 경로의 지원 OS는 Linux/macOS입니다. Windows의 배치 파일 실행은
아직 제공하지 않으므로 네이티브 사전 점검에서 명확히 중단합니다. macOS의 실제
네이티브 빌드도 이번 환경에서는 검증하지 않았습니다.

- `JAVA_HOME` 또는 실행 경로에서 사용할 JDK의 `javac`와 `jarsigner`가 필요합니다.
- `ANDROID_HOME` 또는 `ANDROID_SDK_ROOT`는 SDK 절대 경로여야 합니다.
- `GENIE_GRADLE_EXECUTABLE`로 설치된 Gradle 실행 파일의 절대 경로를 지정하거나, `GRADLE_HOME`으로 설치 폴더를 지정할 수 있습니다. 둘 다 없으면 `GRADLE_USER_HOME` 또는 기본 Gradle 사용자 캐시를 찾습니다. 필요한 빌드 의존성도 이미 있어야 합니다.

명시 경로가 잘못됐거나 빈 문자열이면 다른 설치로 전환하지 않습니다. 설치의
버전이 붙은 CLI JAR와 launcher 참조를 읽어 프로젝트 버전과 대조합니다. 이는
배포본 진위나 실제 실행 성공을 확인하는 검사가 아닙니다. PATH의 임의 Gradle을
자동 선택하지 않습니다. Wrapper의 다운로드를 사용할 별도 검증 경로를 위해
공식 Gradle 8.14.3 배포 SHA-256도 설정에 고정했습니다.

사전 점검은 `android.jar`, 빌드 도구 파일, 실행 파일과 캐시의 존재를 확인합니다.
JDK 버전이나 필요한 모든 Maven 의존성을 실제로 실행하여 검사하지 않으므로,
사전 점검 성공을 컴파일 성공으로 해석하면 안 됩니다.

`bundle`은 Gradle Wrapper를 실행하지 않고 이미 캐시된 배포본을 직접 실행합니다.
`--offline`, `--no-daemon`, `--no-configuration-cache`,
`-Pandroid.builder.sdkDownload=false`를 사용합니다. 캐시가 부족하면 중단하며
자동 다운로드나 도구 설치로 전환하지 않습니다. CLI는 배포·스토어 업로드를 하지 않습니다.

## 작업 사본과 파일 일치 확인

매번 `.genie-release/run-*`라는 새 비공개 작업 폴더를 만듭니다. 원본 Android
프로젝트의 이전 웹 자산, 빌드 결과, 로컬 SDK 경로 파일, 서명 파일과 환경 파일은
복사하지 않습니다. iOS 동기화는 호출하지 않습니다.

1. 원본 소스와 설정의 해시를 기록합니다.
2. 타입 검사 후 새 폴더에 웹을 빌드합니다.
3. 새 웹 파일을 별도 Android 사본에 복사합니다.
4. 모든 웹 파일의 경로·해시가 복사본과 일치하는지 확인합니다. 현재 Cordova 플러그인이 없는 앱에서 Capacitor가 추가하는 빈 `cordova.js`, `cordova_plugins.js` 두 파일만 별도로 허용합니다. 누락, 내용 변경 또는 다른 추가 파일은 중단 사유입니다.
5. 정식 앱 표시·식별자의 release 리소스를 만들고, 런타임 설정에서 작업 경로 등 불필요한 항목을 제거합니다.
6. 소스·공개 설정 지문·네이티브 파일·웹 자산·검증 코드의 일치 기록을 남기고 다시 확인합니다.

준비 기록은 `android/genie-release-manifest.json`에 있으며 공개 키 자체 대신 그
SHA-256을 저장합니다. 이 파일은 앱 웹 자산에 포함하지 않습니다. 상태는
`prepared-not-native-validated`로 기록합니다. 준비 후 소스나 설정, 자산이 바뀌면
기존 기록을 재사용할 수 없습니다. 이 기록은 우발적인 소스 혼합이나 오래된 산출물
재사용을 막기 위한 것이며, 개발 환경에 대한 보안 인증은 아닙니다.

offline `android:bundle`은 실제 네이티브 빌드와 서명 검증까지 성공했을 때만 새 작업 폴더의
`android/app/build/outputs/bundle/release/app-release.aab`와
`ANDROID-BUNDLE.json`을 완료 결과로 안내합니다. 이후에도 상태는
`created-awaiting-device-and-store-review`입니다.

`bundleRelease`와 같은 Gradle 호출에서 `verifyGenieBundleIdentity`도 실행합니다.
이 task는 기존 AGP의 AAPT2 protobuf 클래스로 새 AAB 안의
`base/manifest/AndroidManifest.xml`을 읽어 실제 package·versionCode·versionName을
준비 기록과 대조합니다. 새 의존성이나 별도 도구를 다운로드하지 않습니다.
중복·잘못된 타입·속성·namespace·resource ID, versionCodeMajor 불일치,
빌드 입력 또는 AAB 변경을 거부하며 이전 성공 기록은 task 실행 전에 제거합니다.
CLI는 결과 JSON의 상태·실제 ID/버전과 AAB/준비 기록의 현재 해시까지 대조한 뒤에만
`finalBinaryManifestIdentityVerified: true`를 기록합니다.

기존 Preview용 `native:preview`·`native:sync` 명령과 원본 앱 ID는 유지합니다.
Java 코드의 namespace는 그대로 두고 release 출력의 application ID와 버전만
별도로 적용합니다. 원본 프로젝트에서 준비 기록 없이 직접 release를 실행하면
검증 단계가 중단하도록 연결했습니다. 이 Gradle 경로는 표준 Ubuntu 24.04 실행기의
Java 21·SDK 36 환경에서 합성 설정으로 실제 컴파일·임시 키 서명까지 통과했습니다.

## 과거 검증 이력과 현재 남은 출시 단계

### 2026-11-23 최초 검증: 도구 차단점 해소 작업

`android:jdk`는 기존 Java에 컴파일·서명 모듈이 있는지 먼저 검사합니다. 필요한
모듈이 있을 때만 새 절대 경로를 `--output`으로 지정하여 로컬 실행 도구를 만들 수
있습니다. 시스템 Java나 전역 환경 변수를 바꾸거나 JDK를 다운로드하지 않습니다.
이는 기존 모듈을 호출할 실행 도구를 만드는 기능이며, 완전한 JDK 설치나 Android
Gradle Plugin 호환성을 증명하지 않습니다. 자세한 검증 결과는 해당 도구의 기록을
참고합니다. jmods와 JNI 헤더가 없을 수 있습니다.

실제 Android 컴파일을 위한 별도 검증 경로는 `android:native-check`입니다. 이 명령은
명시한 `--allow-dependency-downloads`가 없으면 중단합니다. Linux의 기존 Java 21,
SDK platform 36, Build Tools 35.0.0을 요구하고, 합성 설정·일회용 키로 release
variant를 컴파일합니다. 후속 unsigned export도 별도의 명시적 허용 경로를 사용하며,
정식 `android:bundle` 명령은 계속 offline입니다.

검증이 성공하면 새 AAB의 서명과 포함된 자산을 확인한 뒤 임시 키와 AAB를 삭제하고
`native-check-passed-not-a-release` 기록만 남깁니다. 실제 서버나 앱을 실행하지
않습니다. 이 경로에도 최종 binary Manifest의 package ID·버전 검증을 연결했습니다.
실기기 검증은 별도로 남습니다. 이 경로는 `.github/workflows/android-native-check.yml`에 연결되어 있습니다.
사용자가 새 빌드 전용 브랜치의 소스 반영과 검증을 승인한 뒤 실제 실행했습니다.
첫 통과 커밋은 `9c88d192f26fd370e02186abad71d5794fabc961`이며,
[실행 기록](https://github.com/jmpark0611-art/bestchoice/actions/runs/45114713986)과
`ANDROID-NATIVE-VERIFICATION-2026-11-23.json`에 범위·결과를 기록했습니다.
최종 binary Manifest 검증을 추가한 후속 실행은
`022bbd56881066c4bb12a2916dda77ad1e3a2028`에서 통과했습니다.
[실행 45129704040](https://github.com/jmpark0611-art/bestchoice/actions/runs/45129704040)의
121개 Gradle task가 성공했고, 실제 AAB의 앱 ID·버전 대조를 확인했습니다.
해당 결과는 `ANDROID-RELEASE-PROGRESS-2026-11-23.json`에 이전 결과와 구분하여 기록했습니다.

실제 빌드에서 Capacitor가 라이브러리 자산 `base/assets/native-bridge.js`를 병합하는
것을 확인했습니다. 검증기는 빌드 전 해당 원본의 SHA-256을 기록하고 AAB의 같은
경로와 대조하며, 빌드 후 원본이 바뀌어도 중단합니다. 다른 추가 파일, 누락,
내용 변경 및 앱 자산과 라이브러리 자산의 경로 충돌은 계속 거부합니다.

빌드 전용 브랜치 `codex/genie-android-native-check-20261123`의 Vercel 자동 배포는
`web/vercel.json`의 `git.deploymentEnabled`에서 끄도록 준비했습니다. 다른 브랜치의
설정은 지정하지 않습니다. 최초 저장소 ID 필터 조회에서는 연결 프로젝트가
반환되지 않았으나, 후속 작업에서 기존 이름으로 `genie-web` 프로젝트를 찾았습니다.
공유 주소 `genie-web-rosy.vercel.app`는 production 배포
`dpl_47WBMiAdKoXvhDzRVEbs88pXJ8BX`(기존 기본 브랜치 `470dba6`)에 연결되어 있습니다.
이는 새 Android 후보의 공유 흐름을 검증한 결과가 아닙니다. 계정 설정 변경이나
웹 배포는 하지 않았습니다.

준비 폴더 `.genie-release/run-*`를 다른 컴퓨터의 native 빌드에 그대로 재사용하지 않습니다.
기록의 sourceRoot와 의존성 링크가 원본 절대 경로를 가리키므로, 대상 컴퓨터에서는
정확한 전체 소스와 lockfile로 새 `android:prepare` 또는 `android:bundle`을 실행합니다.
검증된 네 파일 export를 로컬에서 가져오는 전용 서명 경로는 다운로드한 sourceRoot를
따르지 않고 호출자가 명시한 정확한 로컬 소스 사본과 대조하도록 별도로 구현했습니다.

### 과거 사전 점검의 차단과 후속 해소

초기 작업에서는 실제 설정 여섯 가지와 출시 서명 입력을 연결했지만,
`ANDROID_SDK_MISSING`과 `GRADLE_CACHE_MISSING` 때문에 당시 작업 공간에서 AAB를
만들지 못했습니다. 이후 승인된 native 실행기와 unsigned export·로컬 서명 경로로
실제 후보를 확보했습니다. 이 과거 오류를 현재 AAB 미생성 상태로 재사용하지 않습니다.
실제 연결 정보를 넣은 빌드가 성공해도 앱 실행이나 실제 운영 서버 접속 검증으로
계산하지 않습니다.

### 실제 격리 서버: 기본 흐름과 신고 통합 통과

이미 승인된 별도 격리 환경에서 합성 데이터·분리된 두 세션으로 기본
결정→공유→투표→작성자 집계/삭제 흐름을 확인한 실행 `45163032169`가 통과했습니다.
이 결과는 QA 전용 후속 커밋 `2448544bb6601d4ac5154cd9bfa39722a009f248`의 별도
기록이며, 실제 모델 요청을 사용하지 않습니다. 이후 실행 `45166205966`, job
`137663686487`은 QA 전용 소스 `fff40a925c09183cecee01ff2855f5213a04c91a`에서
신고 제안 RPC의 실제 로컬 HTTP 통합과 guard 검사 41/41을 통과했습니다.
합성 세션 3개로 접근 권한·정상 접수증·동시 동일 요청의 한 번 접수와 한 번 한도
차감·동의 및 내용 검사·원본 삭제 시 신고 행 정리를 확인했습니다. 비공개 schema의
HTTP 거부와 직접 PostgreSQL 역할 권한 거부, 검사 트랜잭션 rollback도 확인했습니다.
제안 SQL SHA-256은
`c81db728edbc2b7584eff86d5aedc79485ba09476d35e06bfb40226d2f82024c`입니다.
추가 변경은 QA 파일 7개이며 서명 AAB를 다시 빌드하거나 변경한 것이 아닙니다.
임시 자원·proxy 정리를 마쳤고, 실제 모델이나 hosted Supabase를 호출하지 않았습니다.
운영 신고 RPC와 운영자의 신고 검토 절차는 활성화하지 않았습니다.
운영에 연결된 Preview를 테스트 서버로 간주하지 않습니다. 기존 운영 마이그레이션과
`vs-decide`를 이 작업에서 변경하지 않습니다.

승인된 로컬 통합 대상은 정확히 `http://127.0.0.1:55321`입니다. 최초 사전 점검에는
listener가 없었지만 후속 실행은 실행별로 소유한 임시 스택·loopback proxy를 만들고
정리하는 경로를 사용했습니다. `scripts/verify-local-integration.mjs`는 이전 보관
도구를 복원하여 현재 API 계약에 맞게 보강했습니다. `--run`과
`GENIE_CONFIRM=isolated-genie-synthetic-only`, 로컬 스택에서 발급한 공개 키가 필요합니다.
키의 로컬 출처·listener 소유권·외부 통신 차단은 실행별 환경 근거로 확인합니다.
리디렉션은 거부하며 정해진 경로에만 요청하고, 출력에 토큰을 기록하지 않습니다.
합성 응답으로 도구를 확인한 결과를 실제 Supabase 검증으로 취급하지 않습니다.

### 현재 남은 출시 확인

API 36 가상기기의 `dev.local.genie.preview`에서 시작, 실제 OS 터치 뒤 시스템
뒤로가기, 320px 화면, 강제종료 후 명시적 초안 복원의 네 시나리오가 통과했습니다.
실행 `45164565371`의 `allFourCasesPassed`, `forceStopConfirmed`, 임시 AVD·debug
키 정리는 모두 확인됐고 guard 검사는 14/14 통과했습니다. 환경은 emulator
`37.3.10.0`, WebView `133.0.6943.137`이며 백엔드 접속과 artifact 보관은 없었습니다.
이 실행의 `d59e5d9…`는 검증 드라이버만 후속 변경한 QA 소스이므로 서명 후보의
`959836f6…`를 대체하는 커밋으로 표시하지 않습니다.

서명 후보 자체와 실물 기기 확인, 공유 링크·투표·신고를 포함한 전체 출시 흐름의
기기 검증은 남습니다. 전용 launcher와 스토어용 아이콘·feature graphic은 준비됐고,
실제 폰 스크린샷과 개인정보 공개 문서·Data safety·심사 입력도 별도로 마무리해야 합니다.

격리 서버 통과와 별개로 실제 운영 신고 기능, 공개 정책 URL, 기존 공유 웹과 이
후보의 호환성 확인도 필요합니다. 검토한 운영 변경과 Google Play 등록·제출은 별도
승인 범위로 진행하며, iOS는 Android 이후 이어갑니다. 구체적인 준비물과 범위는
`PLAY-STORE-PREPARATION.md`에 정리했습니다.

## 근거

- 설치된 소스: `scripts/android-release*.mjs`, `scripts/verify-android-release.mjs`, `android/app/genie-release.gradle`, `android/variables.gradle`, `android/gradle/wrapper/gradle-wrapper.properties`.
- [Android ApplicationVariant API](https://developer.android.com/reference/tools/gradle-api/8.13/com/android/build/api/variant/ApplicationVariant), [VariantOutput API](https://developer.android.com/reference/tools/gradle-api/8.13/com/android/build/api/variant/VariantOutput): release application ID와 버전 적용 API.
- [Android SDK 도구 업데이트 문서](https://developer.android.com/studio/intro/update): Gradle SDK 자동 다운로드 설정.
- [Vite envDir 설정](https://vite.dev/config/shared-options.html#envdir): 환경 파일 로딩 제어. 설치된 Vite 타입 정의와 함께 확인.
- [Gradle 공식 배포 체크섬](https://gradle.org/release-checksums/): 8.14.3 all 배포본과 기존 Wrapper JAR의 SHA-256.
- [AGP 8.13 호환성](https://developer.android.com/build/releases/agp-8-13-0-release-notes): SDK Build Tools 기본값.
- [GitHub Ubuntu 24.04 실행기](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md): 표준 실행기의 Java 21과 Android SDK 제공 목록. 실제 작업에서는 존재를 다시 확인.
- [Vercel Git 배포 설정](https://vercel.com/docs/project-configuration/git-configuration): 특정 브랜치의 자동 배포 비활성화.
