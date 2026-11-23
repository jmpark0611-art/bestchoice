# 결정해지니 Android 출시 준비

이 문서는 기존 기능 소스에 추가한 **로컬 Android 출시 경로**를 설명합니다.
합성 설정과 일회용 키를 사용한 실제 Android 컴파일·서명·자산 대조는
2026-11-23에 통과했습니다. 정식 출시용 AAB, 실제 서버 및 실기기 확인,
Google Play 제출은 남아 있습니다. 상세 결과는 `ANDROID-NATIVE-CHECK.md`에 있습니다.

## 실행 명령

`web` 폴더에서 실행합니다. 설치된 의존성을 사용하며 자동 설치는 하지 않습니다.

| 명령 | 하는 일 | 성공해도 남는 확인 |
| --- | --- | --- |
| `npm run android:check` | 명시한 공개 설정의 형식, 로컬 JDK 도구·SDK 파일·Gradle 배포 캐시·서명 입력의 존재를 읽기 전용으로 확인 | 도구 버전 호환성, 전체 Gradle/Maven 캐시, 키 비밀번호·소유권, 서버 동작 |
| `npm run android:prepare` | 타입 검사, 새 웹 빌드, 별도 사본에서 Android만 동기화, 소스·설정·복사 파일 대조 | 네이티브 컴파일, AAB 서명, 실제 서버 및 실기기 |
| `npm run android:bundle` | 네이티브 준비 조건을 먼저 확인한 뒤 새로 `prepare`하고, 캐시된 Gradle로 AAB 생성 및 `jarsigner` 검증 시도 | 실제 기기, Play Console 검토, 제출·출시 |
| `npm run test:android-release` | 새 출시 경로의 설정 검증·파일 일치·중단 동작을 로컬에서 확인 | 모의 실행 테스트는 실제 Gradle 컴파일·서명 검증을 대신하지 않음 |

`prepare`는 JDK, Android SDK 또는 서명키가 없어도 공개 설정과 기존 웹 의존성이
준비되어 있으면 실행할 수 있습니다. `check`와 `bundle`은 네이티브 준비 조건까지
요구합니다. `bundle`은 이전 `prepare` 결과나 기존 AAB를 재사용하지 않습니다.

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

## AAB 생성에만 필요한 비공개 서명 입력

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

## 기존에 준비되어 있어야 하는 도구

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

실제 네이티브 빌드와 서명 검증까지 성공했을 때만 새 작업 폴더의
`android/app/build/outputs/bundle/release/app-release.aab`와
`ANDROID-BUNDLE.json`을 완료 결과로 안내합니다. 이후에도 상태는
`created-awaiting-device-and-store-review`입니다.

기존 Preview용 `native:preview`·`native:sync` 명령과 원본 앱 ID는 유지합니다.
Java 코드의 namespace는 그대로 두고 release 출력의 application ID와 버전만
별도로 적용합니다. 원본 프로젝트에서 준비 기록 없이 직접 release를 실행하면
검증 단계가 중단하도록 연결했습니다. 이 Gradle 경로는 표준 Ubuntu 24.04 실행기의
Java 21·SDK 36 환경에서 합성 설정으로 실제 컴파일·임시 키 서명까지 통과했습니다.

## 이번 로컬 준비 이후 남는 출시 단계

### 2026-11-23 추가: 도구 차단점 해소 작업

`android:jdk`는 기존 Java에 컴파일·서명 모듈이 있는지 먼저 검사합니다. 필요한
모듈이 있을 때만 새 절대 경로를 `--output`으로 지정하여 로컬 실행 도구를 만들 수
있습니다. 시스템 Java나 전역 환경 변수를 바꾸거나 JDK를 다운로드하지 않습니다.
이는 기존 모듈을 호출할 실행 도구를 만드는 기능이며, 완전한 JDK 설치나 Android
Gradle Plugin 호환성을 증명하지 않습니다. 자세한 검증 결과는 해당 도구의 기록을
참고합니다. jmods와 JNI 헤더가 없을 수 있습니다.

실제 Android 컴파일을 위한 별도 검증 경로는 `android:native-check`입니다. 이 명령은
명시한 `--allow-dependency-downloads`가 없으면 중단합니다. Linux의 기존 Java 21,
SDK platform 36, Build Tools 35.0.0을 요구하고, 합성 설정·일회용 키로 release
variant를 컴파일합니다. 네이티브 의존성 다운로드는 이 별도 검증에서만 허용되며
정식 `android:bundle`은 계속 offline입니다.

검증이 성공하면 새 AAB의 서명과 포함된 자산을 확인한 뒤 임시 키와 AAB를 삭제하고
`native-check-passed-not-a-release` 기록만 남깁니다. 실제 서버나 앱을 실행하지
않습니다. 최종 binary Manifest의 package ID·버전 확인 및 실기기 검증은 별도로
남습니다. 이 경로는 `.github/workflows/android-native-check.yml`에 연결되어 있습니다.
사용자가 새 빌드 전용 브랜치의 소스 반영과 검증을 승인한 뒤 실제 실행했습니다.
최종 통과 커밋은 `9c88d192f26fd370e02186abad71d5794fabc961`이며,
[실행 기록](https://github.com/jmpark0611-art/bestchoice/actions/runs/45114713986)과
`ANDROID-NATIVE-VERIFICATION-2026-11-23.json`에 범위·결과를 기록했습니다.

실제 빌드에서 Capacitor가 라이브러리 자산 `base/assets/native-bridge.js`를 병합하는
것을 확인했습니다. 검증기는 빌드 전 해당 원본의 SHA-256을 기록하고 AAB의 같은
경로와 대조하며, 빌드 후 원본이 바뀌어도 중단합니다. 다른 추가 파일, 누락,
내용 변경 및 앱 자산과 라이브러리 자산의 경로 충돌은 계속 거부합니다.

빌드 전용 브랜치 `codex/genie-android-native-check-20261123`의 Vercel 자동 배포는
`web/vercel.json`의 `git.deploymentEnabled`에서 끄도록 준비했습니다. 다른 브랜치의
설정은 지정하지 않습니다. 반영 직전에 현재 연결된 계정과 팀을 이 저장소 ID로
조회했고 연결 프로젝트가 반환되지 않았습니다. 계정 설정 변경이나 웹 배포는 하지 않았습니다.

현재 준비 폴더 `.genie-release/run-*`를 다른 컴퓨터에 복사해서 재사용하지 않습니다.
기록의 sourceRoot와 의존성 링크가 원본 절대 경로를 가리키므로, 대상 컴퓨터에서는
정확한 전체 소스와 lockfile로 새 `android:prepare` 또는 `android:bundle`을 실행합니다.

기본 실행 경로에는 여전히 정식 설정 여섯 가지, 출시 서명 입력,
Android SDK와 Gradle 배포 캐시가 제공되지 않았습니다. 따라서 출시용 AAB는 아직
생성하지 않았습니다. 합성 설정으로 웹 빌드·파일 복사를 확인해도 실제 서버 접속을
검증한 것으로 계산하지 않습니다.

다음 실행에는 확정한 앱 ID·버전과 승인된 서버/공유 URL, 준비된 네이티브 빌드
환경이 필요합니다. 서버 통합 확인은 이미 접근이 허용된 별도 격리 환경에서 합성
데이터와 분리된 두 세션으로 결정→공유→투표→작성자 집계/삭제를 확인해야 합니다.
운영에 연결된 Preview를 테스트 서버로 간주하지 않습니다. 기존 운영 마이그레이션과
`vs-decide`를 이 작업에서 변경하지 않습니다.

서명된 AAB가 생기면 Android 실기기의 시작·뒤로가기·공유 링크·초안 복원·투표·신고
흐름을 확인하고, 개인정보/스토어 안내와 실제 동작의 일치를 확인합니다.
그 다음 Google Play 제출을 별도 범위에서 진행하며, iOS는 Android 이후 이어갑니다.

## 근거

- 설치된 소스: `scripts/android-release*.mjs`, `scripts/verify-android-release.mjs`, `android/app/genie-release.gradle`, `android/variables.gradle`, `android/gradle/wrapper/gradle-wrapper.properties`.
- [Android ApplicationVariant API](https://developer.android.com/reference/tools/gradle-api/8.13/com/android/build/api/variant/ApplicationVariant), [VariantOutput API](https://developer.android.com/reference/tools/gradle-api/8.13/com/android/build/api/variant/VariantOutput): release application ID와 버전 적용 API.
- [Android SDK 도구 업데이트 문서](https://developer.android.com/studio/intro/update): Gradle SDK 자동 다운로드 설정.
- [Vite envDir 설정](https://vite.dev/config/shared-options.html#envdir): 환경 파일 로딩 제어. 설치된 Vite 타입 정의와 함께 확인.
- [Gradle 공식 배포 체크섬](https://gradle.org/release-checksums/): 8.14.3 all 배포본과 기존 Wrapper JAR의 SHA-256.
- [AGP 8.13 호환성](https://developer.android.com/build/releases/agp-8-13-0-release-notes): SDK Build Tools 기본값.
- [GitHub Ubuntu 24.04 실행기](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md): 표준 실행기의 Java 21과 Android SDK 제공 목록. 실제 작업에서는 존재를 다시 확인.
- [Vercel Git 배포 설정](https://vercel.com/docs/project-configuration/git-configuration): 특정 브랜치의 자동 배포 비활성화.
