# Demo hosting

공개 데모와 브라우저 게이트는 module Worker와 SharedArrayBuffer를 위해 다음 응답 헤더가 필요하다.

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`npm run serve`가 저장소 루트와 owned engine assets를 같은 origin에서 제공한다. 배포 시 `index.js`, `src/`,
`examples/`, `assets/`의 상대 경로를 보존한다. worker graph만 별도 위치로 복사해야 하면 `pyproc-assets`로
manifest와 SRI를 생성하고 전체 7파일 graph를 함께 배포한다.

헤더를 설정할 수 없는 정적 호스팅은 지원 배포가 아니다. `npm run test:preflight`가 그 환경에서
실행 가능한 오류와 필요한 헤더 안내를 검증한다.
