# 결정해지니 출시 브랜드 자산

현재 앱의 노란색(#FFD93B), 파란색(#2F5BFF), 주황색(#FF4D2E)을 사용한 자체 벡터 도안입니다.
두 카드와 체크는 선택 비교, 작은 별은 지니의 도움을 나타냅니다. 외부 로고나 생성 이미지를 사용하지 않았습니다.

- `../public/genie-icon.svg`: Play용 512×512 아이콘 원본. 투명도가 있는 32-bit PNG로 내보냅니다.
- `store-feature.svg`: 1024×500 스토어 그래픽 원본. 글꼴은 Noto Sans CJK KR이며 투명도 없는 RGB PNG로 내보냅니다.
- Android에는 같은 경로 도형을 VectorDrawable로 넣었습니다. 이 앱의 최소 API 24부터 API 25까지는 anydpi-v21, API 26+는 adaptive foreground를 사용합니다.
- 기존 density별 기본 PNG는 보존하며 새 anydpi/adaptive 리소스가 우선 선택됩니다. 출시 후보의 실제 기기 시각 확인이 남습니다.
- 시작 화면은 전용 벡터와 노란색 바탕을 사용합니다.

이 그래픽은 앱 화면 스크린샷이 아닙니다. 스토어 스크린샷은 실제 앱에서 별도로 촬영해야 합니다.

내보내기 예(설치된 Inkscape 사용):

```sh
inkscape public/genie-icon.svg --export-type=png --export-png-color-mode=RGBA_8 --export-filename=/absolute/output/genie-play-icon.png
inkscape branding/store-feature.svg --export-type=png --export-png-color-mode=RGB_8 --export-filename=/absolute/output/genie-play-feature.png
```

공식 사양: https://support.google.com/googleplay/android-developer/answer/9866151
