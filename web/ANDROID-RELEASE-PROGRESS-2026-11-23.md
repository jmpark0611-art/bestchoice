# 결정해지니 Android 출시 준비 — 세 가지 진행 결과

확인일: 2026-11-23, 한국 시간. Android 준비를 먼저 마치고 iOS를 이어갑니다.

**실제 설정을 반영한 Android 준비 사본과 전용 업로드 서명키를 만들었습니다.**
최종 AAB의 앱 ID·버전을 직접 읽는 검증도 실제 Android 빌드에서 통과했습니다.
정식 키로 서명한 출시용 AAB 생성, 실제 격리 서버 통합 및 Android 기기 확인은
현재 실행 환경 부족으로 남았습니다. 스토어 제출이나 운영 변경은 하지 않았습니다.

## 1. 실제 앱 설정: 선택·연결 및 로컬 준비 완료

| 항목 | 준비값 또는 확인 결과 |
| --- | --- |
| 앱 이름 | 결정해지니 |
| 앱 ID 후보 | `com.jmpark0611.genie` |
| 첫 버전 | `1.0.0`, versionCode `1` |
| 연결 대상 | 기존 `bestchoice` 프로젝트 `njrtcxohbkfgrgwhlvua` |
| 서버 원점 | `https://njrtcxohbkfgrgwhlvua.supabase.co` |
| 공유 웹 원점 | `https://genie-web-rosy.vercel.app` |
| 공개 키 | 해당 프로젝트의 활성 publishable key를 확인하여 소스 밖의 비공개 입력 파일에 저장 |

ID와 버전은 새 앱 등록을 위한 준비값입니다. Play Console에 등록했거나 사용 가능
여부를 확인한 값은 아닙니다. 실제 입력으로 `android:prepare`를 실행하여 타입 검사,
새 웹 빌드, 별도 Android 사본으로 동기화 및 파일 일치 확인을 통과했습니다.
소스 135개와 Android 자산 183개를 준비 기록에 결합했습니다. 기록 상태는
`prepared-not-native-validated`이며 준비 기록 SHA-256은 다음과 같습니다.

```text
702b95d634683b929be793103d83cd775ba37084556959795c75d7a7b8c67bd3
```

이 과정은 앱이나 브라우저를 실행하지 않았고 실제 서버로 요청을 보내지 않았습니다.
공유 주소의 현재 production 배포는 기존 기본 브랜치 `470dba6`을 가리킵니다.
플랫폼 메타데이터가 READY라는 사실과 새 후보의 공유 흐름 통과 여부를 구분합니다.
현재 웹 배포와 새 Android 앱의 결정·공유·투표 호환성은 아직 검증하지 않았습니다.

## 2. 업로드 키: 생성·서명 검증·비공개 보관 완료 / 출시 AAB는 차단

결정해지니 전용 PKCS12 업로드 키(RSA 3072비트, 유효 기간 10,000일)를 생성했습니다.
실제 PrivateKeyEntry를 확인하고 새 작은 JAR에 서명한 뒤 `jarsigner`로 검증했습니다.
검증용 JAR는 제거했습니다. 키 저장소, 접근 정보, 공개 인증서, 생성 기록과 실제
앱 입력 파일은 비공개로 보관했고 파일 접근 권한은 0600입니다.

공개 인증서 SHA-256:

```text
1f9dace46345078bcd9089be6c38b6259b83a4e2040611558c9e108eea22ea71
```

다른 앱의 키를 사용하거나 변경하지 않았습니다. 새 키를 Play에 등록하지 않았으며
실제 출시 AAB에 사용하지도 않았습니다. 키와 비밀번호를 GitHub·로그에 넣지 않았고,
서버의 공개 키도 소스에 포함하지 않았습니다.

실제 입력과 이 서명키를 연결한 로컬 사전 점검에서 남은 오류는 정확히 두 개입니다.

- `ANDROID_SDK_MISSING`: Android SDK platform 36 및 Build Tools 35.0.0이 없습니다.
- `GRADLE_CACHE_MISSING`: Gradle 8.14.3 배포본과 필요한 로컬 빌드 환경이 없습니다.

기존 Java 모듈로 키 생성과 서명은 가능했지만 이를 완전한 Android 빌드 환경으로
간주하지 않았습니다. 정식 `android:bundle`은 자동 다운로드 없이 offline으로
실행되며, 이전 검증용 AAB를 출시 파일로 재사용하지 않습니다.

### 실제 AAB의 앱 ID·버전 확인: 추가 검증 통과

[GitHub Actions 실행 45129704040](https://github.com/jmpark0611-art/bestchoice/actions/runs/45129704040)은
2026-11-23 16:16 한국 시간에 성공했습니다.

- 검증 커밋: `022bbd56881066c4bb12a2916dda77ad1e3a2028`
- 환경: Node 24.22.3, Java 21.0.13, Android SDK 36, Build Tools 35.0.0, Gradle 8.14.3
- 결과: `BUILD SUCCESSFUL in 1m 36s`, 121개 task 실행
- 새 `verifyGenieBundleIdentity` task가 AAB의 protobuf Manifest를 직접 읽어 실제 ID·버전을 대조
- 서명, 앱 자산 바이트와 Capacitor 라이브러리 자산, 빌드 후 소스 일치 확인 통과
- `finalBinaryManifestIdentityVerified: true`, 임시 키·AAB 삭제 후 성공 기록, 업로드 artifact 0개

이 실행은 합성 ID `kr.synthfixture.genie`, versionCode 12, versionName `1.2.0`과
일회용 키를 사용했습니다. 위의 실제 앱 ID·키로 만든 출시 AAB의 성공 증거가 아닙니다.
기존 전체 앱 테스트를 반복하지 않았으며 새 범위의 로컬 검사 39개(결과 기록 10,
CLI 연결 5, 로컬 통합 도구 24)가 통과했습니다. 로컬 검사는 합성·주입 실행으로
실제 native 실행과 구분했습니다.

## 3. 격리 서버·Android 기기: 실행 도구 준비 완료 / 실제 실행은 차단

이미 승인된 대상은 정확히 `http://127.0.0.1:55321`입니다. 현재 이 포트에 listener가
없고, 로컬 Supabase·컨테이너 실행 도구도 없습니다. 운영 `bestchoice` 또는 운영에
연결된 Preview를 테스트 서버로 취급하지 않았습니다. Android SDK·adb·에뮬레이터와
사용 가능한 Android 기기도 확인되지 않아 기기 검증은 실행하지 않았습니다.

기존 보관 통합 도구를 원본 ZIP 해시와 대조해 복원했고, 현재 앱의 응답 계약에 맞춰
`scripts/verify-local-integration.mjs`를 준비했습니다. 이 도구는 분리된 두 익명 세션으로
다음 흐름을 확인하도록 되어 있습니다.

1. 합성 결정 생성, 작성자 조회와 타인의 직접 접근·수정 거부.
2. 작성자 공유와 공유 반복 요청, 타인의 공유 요청 거부.
3. 투표 전 결과 비공개, 작성자 자기 투표 거부, 중복 투표 방지.
4. 투표 후 재조회에서 내 투표·결과·집계가 유지되는지 확인.
5. 실제 선택 기록, 타인의 삭제 요청 후 기록·공유·집계 보존.
6. 작성자 삭제 후 행과 공유 링크 접근 불가.

실제 실행에는 로컬 스택 발급 키, 정확한 listener 소유권, 외부 통신이 차단된
결정용 Edge runtime과 폐기 가능한 데이터 볼륨이 먼저 확인되어야 합니다.
명시적 `--run` 및 `GENIE_CONFIRM=isolated-genie-synthetic-only`가 있어야 요청하며,
리디렉션·다른 원점·허용하지 않은 경로를 거부합니다. 테스트 24개는 가짜 전송
함수로만 실행했습니다. 실패 시 삭제 요청의 HTTP 성공을 삭제 확인으로 주장하지
않고, 익명 계정·로그와 미확인 요청의 잔여 데이터는 격리 볼륨 폐기로 처리해야 합니다.

Android 기기에서는 시작·뒤로가기·공유 링크·투표, 초안 복원과 새로고침,
클립보드 거부 및 좁은 화면의 현재 구현을 확인해야 합니다. 실제 서버에 쓰는 검증은
승인된 격리 대상에서만 수행합니다.

## 이어가기 위한 환경 결정

현재의 “새 도구 설치 없이, 이미 접근 가능한 격리 환경에서만 검증” 범위를 지키면
여기서 실제 실행이 차단됩니다. 다음 실행에는 다음 조건이 충족된 환경이 필요합니다.

| 필요 환경 | 구체적인 조건 |
| --- | --- |
| 비공개 출시 빌드 | Java 21 전체 JDK, SDK 36/Build Tools 35.0.0, Gradle 8.14.3와 의존성 캐시, 비공개 키 입력·산출물 보관 경로 |
| 격리 서버 | 승인된 127.0.0.1:55321, 독립 데이터 볼륨, 해당 로컬 공개 키, 외부 통신 차단·합성 결정 runtime |
| Android 검증 | 실제 사용 가능한 Android 기기 또는 승인된 Android 에뮬레이터 |

기존 준비된 환경을 연결하거나, 위 목적에 한해 필요한 도구 설치·새 격리 환경 구성을
허용하는 범위 결정이 필요합니다. 후자를 진행하더라도 운영 데이터·설정·마이그레이션,
기존 `vs-decide`, 다른 앱의 키, 외부 계정·결제와 스토어 제출은 변경 대상이 아닙니다.
새 환경이 실제로 실행 가능한지 확인하기 전까지 AAB·서버·기기 통과를 약속하지 않습니다.

## 원본과 증거

- 앱 입력의 공개 지문: `ANDROID-RELEASE-PROFILE.json`.
- 기계 판독 결과와 새 native receipt: `ANDROID-RELEASE-PROGRESS-2026-11-23.json`.
- 기존 최초 native 통과 기록: `ANDROID-NATIVE-VERIFICATION-2026-11-23.json`을 보존.
- 원본 로컬 통합 ZIP SHA-256: `df5df614b263e40ad67273d90348899693ee3099be28c874f03efa089d26387e`.
- 승인된 빌드 브랜치에 13개 파일만 반영하고 기존 다른 파일 223개의 해시와 mode를 보존.
- 기본·웹 후보·기타 기존 브랜치, 기존 `app/`, Supabase 함수·마이그레이션을 유지.
- [Android 앱 서명 공식 문서](https://developer.android.com/studio/publish/app-signing): 업로드 키와 앱 서명 키의 역할.
- [AAPT2 protobuf 스키마](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/tools/aapt2/Resources.proto): 최종 Manifest 파싱 형식.

웹 배포·병합·운영 데이터 쓰기·스토어 제출은 수행하지 않았고 새 유료 리소스를
만들지 않았습니다. 현재 결과물을 완료된 정식 출시로 표시하지 않습니다.
