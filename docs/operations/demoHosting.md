# 데모 호스팅 - 라이브 URL 절차

외부인이 "꺼지지 않는 파이썬 컴퓨터"를 클릭 한 번으로 만져보게 하는 절차. 저장소는 빌드 없는 정적
파일이라 정적 호스팅에 그대로 올라간다. 준비물은 저장소에 이미 있다.

## 제약 (왜 아무 데나 안 되나)

- SharedArrayBuffer/JSPI는 **crossOriginIsolated** 페이지에서만 열린다 = 응답에 COOP/COEP 헤더 필요.
- **GitHub Pages는 커스텀 응답 헤더를 못 달아서 불가.** Cloudflare Pages / Netlify는 루트의
  [_headers](../../_headers) 파일로 해결된다(저장소에 포함됨).

## 절차 (소유자, 1회)

1. Cloudflare Pages(권장) 또는 Netlify에서 이 GitHub 저장소를 연결한다.
   - 빌드 명령: 없음. 출력 디렉터리: `/` (저장소 루트 그대로).
2. 배포되면 확인 경로:
   - `/examples/machine.html` - 파이썬 머신(잠자기/부활/.pymachine 내보내기)
   - `/examples/terminal.html`, `/examples/processOs.html`, `/examples/basic.html`
   - 페이지 콘솔에서 `crossOriginIsolated === true`면 헤더가 산 것.
3. 데모 URL을 얻으면:
   - README 2종 상단에 라이브 데모 링크 추가.
   - `gh repo edit --homepage <URL>`.

## 주의

- 데모는 Pyodide 코어를 CDN(jsdelivr)에서 받는다. 오프라인 데모까지 보이려면 machine.html이
  이미 쓰는 OPFS 캐시(coreCacheDir) 경로로 충분하다(2차 방문부터 네트워크 0).
- 커스텀 도메인/analytics는 소비 제품 몫. 여기는 라이브러리 데모까지만.
