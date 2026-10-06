# 32-nativeWindowObservation - 브라우저 밖 Windows 표면을 같은 증거 경계로 관찰하고 조작할 수 있는가

## 가설

독립 Windows 창(파일 선택창, 데스크톱 폼)과 창의 입력기 상태는 UI Automation과 입력기 창 메시지로 관찰할 수 있다.
관찰한 실행 파일, 창 제목, 표면 지문에 결속한 대상만 UI Automation 패턴이나 물리 입력으로 조작하면,
웹 fixture의 관찰로 대체하지 않고도 파일 선택과 한글 조합 입력을 접촉 전에 검증할 수 있다.
물리 입력은 대상이 정확히 그 점에 있을 때만 보내야 하며, 사용자의 물리 입력이 들어오면 즉시 멈춘다.

## 졸업 게이트

1. `pyproc/control` 공개 operation이 허용한 독립 창의 Situation을 반환하고, Motor가 같은 표면 지문으로 결속한다.
   Chromium의 파일 선택창과 Tk 파일 선택창에서 파일 이름 설정과 열기가 창 닫힘으로 확인된다.
2. 입력기 경유 텍스트가 `osInput`의 절대 `setValue` 경로로 제공된다. Chromium contenteditable과 Win32 edit에서
   한글 조합 이벤트가 실제로 발생하고 최종 값이 요청과 같다. ControlLease와 사용자 우선 규칙을 유지한다.
3. 모든 물리 클릭은 접촉 전에 점의 소유 창과 UI Automation 대상을 확인한다. 가려진 대상과 창 밖 대상은
   `notSent`로 거절된다. 같은 규칙이 배포된 host의 `os_activate`에도 들어간다.
4. Chromium 창의 중복 UI Automation 결과를 runtime id로 접어서 정확한 대상 하나를 얻는다.
5. 위 1~4가 반복 가능한 Windows Motor 설치본 gate에 들어간다.

## 실행

- `nativeProbe/`: 측정용 Rust probe. 명령은 `windows`, `observe`, `waitWindow`, `act`, `inputMethod`, `type`,
  `click`, `key`, `foreground`, `idle`이다. 출력에 창 핸들과 좌표를 싣지 않는다.
- `fixtureProbe.mjs`: probe를 저장소 밖 폴더에 빌드하고 자체 WinForms fixture 두 창으로 측정한다.
  `PYPROC_ATTEMPT_TARGET=<저장소 밖 절대 경로> node tests/attempts/32-nativeWindowObservation/fixtureProbe.mjs`
- 사용자 데스크톱에 실제 입력을 보내므로 사람이 입력하지 않을 때 실행한다. probe는 저수준 hook으로
  물리 입력을 보면 다음 입력을 보내지 않는다.
- `foreground`는 창을 앞으로 가져오기를 요청만 한다. 처음 측정 때는 foreground 잠금을 풀려고 Alt 입력을 확인 없이
  주입했다. 그 입력은 그때 앞에 있는 창, 곧 사람의 창으로 갈 수 있어서 2026-10-06 검토 뒤 뺐다. foreground 잠금이 있는
  환경에서는 사람이 fixture 창을 앞으로 가져와야 `click`, `key`, `type` 사례가 돈다.

## 결론 표

| 날짜 | probe | 환경 | 핵심 관찰 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-10-06 | nativeProbe observe | Windows 11 26200, Chrome 격리 프로필, 합성 웹 앱 | Chromium 창이 웹 본문을 UI Automation으로 노출한다(role, label 이름, element id가 automationId). 같은 창의 descendant 조회가 같은 요소를 최대 121번 반환했고, 원시 3984건이 runtime id로 49건이 됐다 | 웹 본문도 같은 관찰 경로로 볼 수 있으나 runtime id 중복 제거가 필수 | host `exact_element`에 같은 중복 제거 |
| 2026-10-06 | nativeProbe type | 한국어 IME(0412), Chrome input과 contenteditable | 입력기 기본 창에 `WM_IME_CONTROL` 변환 모드 설정 뒤 SendInput 가상 키를 보내면 trusted `compositionstart`, `compositionupdate`, `insertCompositionText`가 발생했다. 두벌식 자동기가 사람 입력처럼 음절을 다시 나눴고 마지막 음절은 조합 중으로 남았다. `compositionend`는 Chromium이 `isTrusted false`로 보낸다 | 실제 입력기 조합을 재현할 수 있다 | 절대 `setValue` 계약으로 정리 |
| 2026-10-06 | nativeProbe click | Chrome contenteditable 조합 중 | 페이지 버튼을 물리로 누르면 mousedown에서 조합이 먼저 확정되고 click이 뒤따랐다. 조합 글자 손실과 중복은 없었다 | 페이지의 조합 중 버튼 무시 분기는 물리 마우스에서 도달하지 않는다 | 관찰 사실로만 기록 |
| 2026-10-06 | nativeProbe act | Chrome `<input type=file>` 선택창, Tk `askopenfilename` 선택창 | 파일 이름(1148) `setValue`와 열기(1) `Invoke`로 사진 3장, 영상 1개, ZIP 1개를 골랐다. 여러 장 선택은 열기가 splitbutton, 한 장은 button이었다. 폴더 이동 뒤에도 표면 지문이 같았다. Tk 선택창은 열릴 때 foreground가 아니었으나 UI Automation 조작은 성공했다 | 독립 선택창을 관찰 증거로 조작할 수 있다 | 공개 operation과 Situation으로 승격 |
| 2026-10-06 | nativeProbe click | headed Chrome에 1440 viewport 에뮬레이션, 실제 창 945px | 대상의 UI Automation 사각형 중심이 창 밖이었고 foreground 확인만 한 클릭이 아래에 있던 다른 앱 창에 한 번 들어갔다. 다음 단계는 foreground 불일치로 키를 보내지 않았다 | foreground 확인만으로는 물리 클릭을 막지 못한다 | 점의 소유 창과 대상 확인 추가 |
| 2026-10-06 | fixtureProbe --only occlusion | WinForms 대상 위에 TopMost 덮개 창 | hit test를 뺀 빌드는 클릭이 덮개 창에 들어가 FAIL, `WindowFromPoint` 최상위 창과 `ElementFromPoint` 조상 확인을 넣은 빌드는 `PROBE_TARGET_OCCLUDED`, `notSent`로 PASS | 접촉 전 hit test가 다른 창 클릭을 막는다 | 배포 host `os_activate`에 같은 규칙 |
| 2026-10-06 | fixtureProbe | WinForms fixture 두 창, 한국어 IME | observation, fences(다른 실행 파일, 바뀐 표면, 없는 대상), occlusion, hangul(Win32 edit에 `한글 입력`), dialog(OpenFileDialog 한글 파일명), surfaceChange 6/6 PASS | probe 단계의 가설은 실측됐다 | 계약과 설치본 gate |

## 판정

진행 중. probe 수준의 관찰, 결속, 조합 입력, 선택창 조작과 hit test는 실측했다. `pyproc/control` 공개 operation,
Motor Situation 결속, 절대 `setValue` 계약, 배포 host 반영과 설치본 gate(졸업 게이트 1~5)는 아직이다.
