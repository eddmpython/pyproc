# Demo hosting

공개 데모와 브라우저 게이트는 module Worker와 SharedArrayBuffer를 위해 다음 응답 헤더가 필요하다.

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`npm run serve`가 저장소 루트와 owned engine assets를 같은 origin에서 제공한다. 배포 시 `index.js`, `src/`,
`examples/`, `assets/`의 상대 경로를 보존한다. worker graph만 별도 위치로 복사해야 하면 `pyproc-assets`로
manifest와 SRI를 생성하고 전체 7파일 graph를 함께 배포한다.

일반 소비 배포는 위 헤더를 서버에서 설정한다. 프로젝트의 GitHub Pages 데모만 예외로, 루트
`coiServiceWorker.js`와 `examples/coiBootstrap.js`가 첫 방문에 Service Worker를 설치하고 한 번 다시
열어 같은 헤더를 주입한다. `.github/workflows/pages.yml`은 `PYPROC_NO_COI=1 npm run test:examples`로
이 경로를 배포 전에 검증한다. 다른 정적 호스팅에서 이 우회로를 채택하지 않으면
`npm run test:preflight`가 실행 가능한 오류와 필요한 서버 헤더를 안내한다.
