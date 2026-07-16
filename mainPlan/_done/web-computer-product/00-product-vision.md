# 00. 제품 비전

## 한 줄

주소 하나를 열면 Python OS와 Linux가 함께 켜지고, 닫아도 상태가 남으며, 한 파일로 다른 브라우저에 옮겨지는 Web Computer를 제공한다.

## 사용자가 얻는 결과

- Python 코드를 실행하는 별도 컴퓨터와 Linux shell을 같은 workspace에서 사용한다.
- Save를 누르면 memory와 file이 같은 완료 경계로 남는다.
- 브라우저를 완전히 닫아도 다음 실행에서 부팅 없이 이어진다.
- `.webmachine` 파일의 signer와 요구 권한을 확인한 뒤 다른 browser profile에서 연다.
- server VM 계정이나 원격 desktop 없이 계산과 상태가 사용자 장치 안에 남는다.

## 제품 경계

- 지원 표면은 Chromium/Edge와 cross-origin isolation이다.
- 공개 inbound socket과 로컬 하드웨어 직접 접근을 약속하지 않는다.
- Linux 실행 자산은 제품 code와 분리하며 재현 가능한 이미지와 compliance가 끝나기 전에는 development image로 표시한다.
- pyproc 공개 package의 정체성은 Python guest OS로 유지한다.

## 실패 기준

다음 중 하나라도 발생하면 제품 완료가 아니다.

1. UI가 probe나 package deep path를 import한다.
2. 새 browser process에서 저장한 두 guest 중 하나라도 boot부터 다시 시작한다.
3. 서명 검증 전에 image payload나 engine을 연다.
4. 테스트용 binary를 npm package 또는 git 추적 파일에 포함한다.
5. 사람이 누르는 핵심 동선과 다른 전용 test API로만 통과한다.
