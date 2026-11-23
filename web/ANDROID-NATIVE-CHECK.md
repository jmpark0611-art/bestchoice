# Android 도구 차단점과 다음 실행 범위

작성일: 2026-11-23 (한국 시간)

## 이번에 실제로 해결한 것

기본 PATH에 `javac`·`jarsigner` 실행 파일이 없었지만, 설치된 Java 21.0.13에는
컴파일·서명 모듈이 남아 있었습니다. 새 설치 없이 작업 폴더에 실행 도구를 만들었고,
실제 Java 클래스 컴파일·실행, JAR 생성, 일회용 키 생성, JAR 서명 및 검증을 통과했습니다.
검증에 사용한 비공개 키는 삭제했습니다. 공백·따옴표·달러 기호가 있는 경로도
명령 확장 없이 처리되는 것을 확인했습니다.

이 결과는 **기존 Java 모듈 실행 도구가 동작한다는 증거**입니다. 완전한 JDK 설치,
Android Gradle Plugin 호환성, Android 앱 컴파일 또는 출시 서명을 완료한 것은 아닙니다.
현재 Java에는 jmods와 JNI 헤더가 없습니다. Android SDK와 Gradle 배포/의존성 캐시도
없습니다. 자식 프로세스에서만 로컬 도구 경로를 지정해 사전 점검했을 때,
`javac`와 `jarsigner` 누락 항목은 해소되고 SDK·Gradle·정식 서명 입력 항목이 남았습니다.

추가로 기존 Gradle 설치를 명시할 수 있게 했습니다. `GENIE_GRADLE_EXECUTABLE`,
`GRADLE_HOME`, 기존 wrapper cache 순으로 찾으며, 잘못된 명시 값이 있으면 다른
설치로 전환하지 않습니다. 실행 파일과 버전 표식을 읽는 검사이고 실제 Gradle
실행이나 배포본 진위 검증은 아닙니다. Windows 배치 실행은 미지원으로 명확히 중단합니다.

도구·실행 흐름 관련 검사는 **26개가 통과**했습니다. 기존 앱 전체 테스트는 반복하지
않았습니다. 이 중 Python ZIP 검사는 실제로 작은 로컬 ZIP을 읽어 정확한 자산만
허용하고 추가 파일이나 변경된 바이트를 거부하는 것을 확인했습니다. 모의 AAB 흐름
테스트를 실제 Android 빌드로 계산하지 않았습니다.

## 지금 가능한 다음 경로

기존 저장소 `jmpark0611-art/bestchoice`는 읽기 전용 조회 결과 공개 저장소입니다.
확인한 웹 후보 브랜치 `codex/genie-v7-release-candidate-20261120`의 현재 커밋은
`6cb0b24748dae152e66f8f4639506dba53b618cf`입니다. 새로 준비한 빌드 브랜치는 아직
원격에 만들지 않았습니다.

| 항목 | 준비한 범위 |
| --- | --- |
| 새 브랜치 | `codex/genie-android-native-check-20261123` |
| 시작 기준 | 위의 정확한 웹 후보 커밋에서 분기. 반영 직전 다시 확인 |
| 반영 대상 | 이번까지의 최신 `web/` 변경분과 새 `.github/workflows/android-native-check.yml` |
| 보존 대상 | 기본 브랜치, 기존 출시 후보 브랜치, 기존 `app/`, Supabase 함수·마이그레이션 |
| 실행기 | 공개 저장소의 표준 `ubuntu-24.04`, 최대 25분 |
| 도구 | 실행기에 이미 제공되는 Java 21, SDK platform 36, Build Tools 35.0.0. 없으면 중단 |
| 의존성 | package-lock 기준 npm 설치; 공식 체크섬으로 고정한 Gradle 8.14.3 및 네이티브 빌드 의존성 다운로드 |
| 앱 입력 | 합성 URL·공개 키·검증용 앱 ID만 사용. 실제 서버 접속이나 앱 실행 없음 |
| 서명 | 실행 중 생성한 일회용 키. 계정·운영 서명키를 읽지 않음 |
| 검사 | 새 Android 사본에서 실제 release 컴파일, AAB 서명, 패키지 내 웹 자산의 경로·바이트 대조 |
| 결과 | 성공 시 임시 키와 AAB를 삭제하고 커밋·해시·확인 범위를 job summary에 기록 |
| 원격 기록 | GitHub 코드와 빌드 로그·요약. 별도 artifact/cache 업로드 없음 |

표준 GitHub 실행기의 공개 저장소 사용은 공식 문서상 무료입니다. 유료 실행기,
새 유료 환경 또는 계정 결제 설정을 사용하지 않도록 구성했습니다. 저장소가 비공개면
job 조건에서 실행하지 않습니다. 실제 원격 실행은 아직 하지 않았습니다.

Vercel Git 연동이 있으면 브랜치 push가 웹 자동 배포로 이어질 수 있으므로,
`web/vercel.json`에서 **위의 새 빌드 브랜치만** 자동 배포를 끄도록 준비했습니다.
읽기 전용으로 확인한 현재 Vercel 계정/팀에서는 이 GitHub 저장소 ID로 연결된
프로젝트가 반환되지 않았습니다. 이것은 다른 계정의 연결까지 없다는 증거는 아니므로,
실제 반영 직전 연결 상태와 프로젝트 root directory를 다시 확인해야 합니다.

## 왜 아직 원격 실행하지 않았는가

사용자의 기존 지시에는 **어디에도 업로드·푸시·병합·배포하지 말 것**이 포함되어
있습니다. 로컬 코드와 실행 구성을 완성해 검토 가능한 상태로 만들었지만,
위 공개 저장소의 새 브랜치에 소스를 올리는 작업은 그 제한을 바꾸는 것이므로 아직
실행하지 않았습니다. 이 범위에 대한 허용이 있어야 다음 원격 빌드를 시작할 수 있습니다.

허용을 구하는 범위는 **위 새 빌드 브랜치에 필요한 소스를 반영하고 표준 실행기에서
합성 설정으로 네이티브 빌드를 한 번 실행하는 것**입니다. 기본 브랜치 병합,
운영 데이터·설정 쓰기, 웹 배포, 스토어 제출을 포함하지 않습니다. 공개 저장소에
반영하는 코드와 그 빌드 로그는 공개될 수 있습니다.

## 검증 성공 뒤에도 남는 것

원격 네이티브 확인이 성공해도 정식 앱 패키지 ID·버전, 승인된 서버와 공유 웹 주소,
정식 업로드 서명키가 자동으로 확정되는 것은 아닙니다. 최종 AAB의 binary Manifest
식별자 확인, 별도 격리 서버의 두 세션 통합 확인, 실기기 확인도 남습니다.
이후 정식 입력으로 `android:bundle`을 새로 실행해 보관할 출시용 AAB를 생성합니다.

## 근거

- 로컬 실행 기록: `JAVA-MODULE-ADAPTER-PROOF.json`, `android-unblock-prerequisites.json`, `android-unblock-focused-tests.log`.
- [GitHub 표준 실행기와 공개 저장소 요금](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
- [Ubuntu 24.04 제공 도구](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md).
- [Gradle 8.14.3 공식 배포 체크섬](https://gradle.org/release-checksums/).
- [AGP 8.13 호환성](https://developer.android.com/build/releases/agp-8-13-0-release-notes).
- [Vercel 브랜치별 자동 배포 설정](https://vercel.com/docs/project-configuration/git-configuration).
- Gradle 설치 표식은 [공식 v8.14.3 배포 생성 코드](https://github.com/gradle/gradle/blob/e5ee1df3d88b8ca3a8074787a94f373e3090e1db/build-logic/packaging/src/main/kotlin/gradlebuild.distributions.gradle.kts), [시작 스크립트 생성 코드](https://github.com/gradle/gradle/blob/e5ee1df3d88b8ca3a8074787a94f373e3090e1db/build-logic/jvm/src/main/kotlin/gradlebuild/startscript/tasks/GradleStartScriptGenerator.kt), [모듈 이름 규칙](https://github.com/gradle/gradle/blob/e5ee1df3d88b8ca3a8074787a94f373e3090e1db/build-logic-commons/module-identity/src/main/kotlin/gradlebuild.module-identity.gradle.kts)을 조합해 확인했습니다. 배포 바이너리를 실제 실행한 근거와 구분합니다.
