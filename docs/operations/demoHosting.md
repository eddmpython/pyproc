# 데모 호스팅 - 라이브 URL 운영

정본은 **GitHub Pages**다(방침: 외부 서비스 최소화, 깃헙 안에서). 저장소는 빌드 없는
정적 파일이라 [.github/workflows/pages.yml](../../.github/workflows/pages.yml)이 push마다
데모 사이트를 조립해 자동 배포한다. 따로 손댈 것은 없다.

## GH Pages의 헤더 제약과 실측된 해법

GitHub Pages는 커스텀 응답 헤더(COOP/COEP)를 못 단다. 실측(pythonMachine 캠페인)으로 경로를 확보했다:

- **머신 핵심 동선은 COI가 필요 없다**(noCoiProbe 7/7): 부팅, 세션 부활, `.pymachine` 왕복,
  /home 디스크, JSPI(터미널 input)까지 헤더 없이 정상. machine/terminal/basic 데모는 그대로 돈다.
- **SAB가 필요한 것(프로세스 OS)만** SW 헤더 주입으로 연다(swCoiProbe 4/4):
  `pyprocSw.js?coi=1`이 문서/워커 응답에 COOP/COEP를 주입하고, 첫 방문은 1회 자동 새로고침.
  processOs.html에 부트스트랩이 내장되어 있고, pages 워크플로가 SW 사본을 배포 루트에 둔다
  (SW는 스코프 상위 파일을 등록할 수 없어서 사본이 계약이다).

## 배포 구조 (pages.yml이 조립)

```text
_site/
  index.html        <- 랜딩(워크플로가 생성. 저장소 루트를 오염시키지 않는다)
  pyprocSw.js       <- src/capabilities/pyprocSw.js의 루트 사본(?coi=1 스코프 확보)
  examples/  src/  index.js  index.d.ts  LICENSE
```

## 예비: Cloudflare (연결하지 않음, 기록만)

- 루트 [_headers](../../_headers)는 Cloudflare Pages/Netlify가 그대로 읽는 형식으로 유지한다.
  GH Pages가 막히거나 진짜 헤더가 필요한 데모가 생기면 전환할 예비.
- dartlab의 wrangler 인증이 이 머신에 살아 있어(eddmpython 계정, CLOUDFLARE_API_TOKEN)
  전환 결정 시 대시보드 없이 `wrangler pages deploy`로 몇 분 안에 열 수 있다(2026-07-12 확인).

## 확인 절차 (배포 후)

- `https://eddmpython.github.io/pyproc/` 랜딩 -> examples 링크 4종.
- machine.html: 새 컴퓨터 부팅 메시지 + 탭 닫았다 열기 resume.
- processOs.html: 첫 방문 1회 새로고침 후 워커 4개 병렬 수치.
