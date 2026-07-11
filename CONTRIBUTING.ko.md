# pyproc 기여 안내

언어: [English](CONTRIBUTING.md) | 한국어

pyproc은 재사용 가능한 브라우저 파이썬 런타임이다(Pyodide 위의 프로세스·병렬·복원 리액티브). 관심에 감사한다. 이 문서가 저장소 참여의 계약이다.

## 라이선스 상태 (먼저 읽을 것)

라이선스는 **아직 미정**이다(소유자 결정 대기). 저장소 루트에 LICENSE 파일이 생기기 전까지:

- **코드 기여(풀 리퀘스트)는 보류다.** 라이선스·기여 조건이 불명확한 상태로 외부 코드를 병합하면 이력이 오염된다.
- **그 외는 전부 환영이다**: 버그 리포트, 브라우저 실측(Chrome/Edge 버전과 하드웨어 명시), 재현 페이지, 이슈를 통한 문서 지적, 설계 토론.

라이선스가 확정되면 이 절은 실제 조건으로 교체된다.

## 스코프 (헛수고 방지)

- **Chromium / Edge 전용.** JSPI, SharedArrayBuffer, `crossOriginIsolated`가 필요하다. Firefox/Safari 대응은 의도된 스코프 밖이며, 호환 심(shim) PR은 받지 않는다.
- **제품 UI·도메인 로직 금지.** pyproc은 런타임 프리미티브와 능력 계약만 싣는다. 제품은 그 위에 자기 표면을 얹는다.
- **빌드 단계 영구 금지.** 네이티브 ESM `.js` + 손으로 유지하는 `index.d.ts`. 번들러·트랜스파일러는 도입하지 않는다.

## 작업 흐름

1. **신규 능력은 `tests/attempts/<카테고리>/`에서 시작한다.** `src/` 직행 금지. 카테고리는 가설과 명시적 졸업 게이트를 가진 질문 하나이고, 브라우저 실측으로 입증한다. [tests/attempts/README.md](tests/attempts/README.md) 참조.
2. **졸업한 학습은 `mainPlan/<이니셔티브>/`에서 계획이 된다**(번호 문서 + 진행 원장). 완료된 이니셔티브는 `mainPlan/_done/`으로 이관.
3. **그 다음에야 코드가 `src/`에 들어간다.** src는 폴더 = 레이어다: `src/runtime/`, `src/capabilities/`, `src/processOs/`. import는 단방향(Layer 0 방향)이고, 엔진 내부는 능력 계약 뒤에 머문다.

운영 상세는 [docs/](docs/README.md).

## 개발 환경

```bash
git clone <repo> && cd pyproc
git config core.hooksPath .githooks   # 저장소 가드 훅 활성화
npm test                              # Node 구조 게이트, 의존성 0
npm run serve                         # 브라우저 실측용 COOP/COEP 정적 서버
```

브라우저 실측: Chrome/Edge에서 `http://localhost:8788/examples/basic.html`과 `processOs.html`을 연다. 페이지에서 `crossOriginIsolated === true`여야 한다. WASM 런타임의 진짜 검증은 브라우저에서만 가능하다. [docs/operations/testing.md](docs/operations/testing.md) 참조.

## 절대 게이트 (기계 강제)

- 모든 커밋 전 `npm test` green.
- **main 전용.** 이 저장소에서 로컬 브랜치 금지(훅이 non-main ref 차단). 외부 기여는 포크에서 `main`을 향해 온다.
- 모든 `*.md`/`*.js`에 **em dash(U+2014) 금지.** 하이픈, 쉼표, 문장 재구성으로 대체. pre-commit 훅이 차단한다.
- 커밋 메시지·주석·문서에 **도구·생성 흔적 금지**(commit-msg 훅이 특정 흔적 용어 목록을 차단한다). 커밋 메시지는 직접 쓴다: 변경 범주 + 무엇이 바뀌었는지. 저장소 관례는 한국어이고, 외부 기여는 명확한 영어도 받는다.
- 버전은 `0.0.x` 라인 유지. 릴리즈 때만 올리고 태그와 `package.json`이 일치해야 한다. [docs/operations/release.md](docs/operations/release.md) 참조.

## PR 체크리스트 (라이선스 확정 후)

- [ ] `npm test` green.
- [ ] 런타임 동작 변경은 PR 설명에 브라우저 실측(페이지, 수치, 환경) 포함.
- [ ] 공개 표면 변경은 같은 변경에서 `index.d.ts`와 README 사용례 갱신.
- [ ] 능력 계약 밖으로 엔진 내부(`HEAPU8`, 스택 포인터) 노출 없음.
- [ ] 변경과 모순되는 문서를 같은 변경에서 갱신.
- [ ] 신규 능력이라면 `tests/attempts/` 졸업을 먼저 거쳤는가.

## 이슈 제보

포함할 것: 무엇을 실행했나(코드 또는 페이지), 기대 vs 실제, 브라우저 + 버전, `crossOriginIsolated` 여부, 콘솔 출력. 성능 제보는 하드웨어(코어 수, RAM)를 명시한다(병렬 speedup 주장이 거기 의존한다).
