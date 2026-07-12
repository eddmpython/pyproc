# wasiPackages - WASI CPython 위 패키지 생태계

> **졸업(2026-07-13).** 개념 GREEN 9/9 -> src 승격: `wheelUnzip.js`(네이티브 unzip),
> `WasiSession.installWheel`(라이브 pip), `bootWasi({ wheels })`(부팅 시 설치),
> 드라이버 `sys.path += /site`, 워커 쓰기 가능 `/site` preopen. 영구 가드 = `tests/browser/wasiGate.html`
> (six 단일 모듈 + packaging 중첩 패키지 + C 확장 벽). 이 폴더는 이제 재현 wheel 자산의 홈 +
> 개념 기록으로만 남는다(프로브 코드는 승격돼 삭제). 정본 결정은 원장 참조.

## 개념 캠페인

질문 하나: **non-Pyodide CPython(WASI)이 stdlib를 넘어 "진짜 파이썬 패키지"를 import하고 쓸 수 있는가.**

[enginePort](../enginePort/README.md)가 부팅/결정성/반복실행/값프로토콜/완전 시간여행까지 실증하고 `bootWasi`/`WasiSession`으로 src 승격됐다. 하지만 거기서 도는 건 stdlib 뿐이다. "진짜 파이썬이 굴러갈 **수준**"(= Pyodide 급)과 WASI 사이에 남은 가장 큰 벽은 패키지다. `2+2`는 돌지만 `import`가 안 되면 그 수준이 아니다. Pyodide의 킬러 피처가 355개 패키지 생태계인데 WASI는 지금 그게 없다.

근본: Pyodide는 `micropip`으로 wheel을 힙에 풀고, C 확장은 emscripten으로 미리 빌드해 동적 링크한다. WASI엔 그 배관이 없다. 하지만 **순수 파이썬 패키지는 그냥 `.py` 파일 묶음**이고, WASI CPython은 preopen 파일시스템을 가진다. 그러면 wheel(=zip)을 풀어 preopen 디렉터리에 얹고 `sys.path`에 연결하면 import machinery가 찾아낼 것이다 - 이게 가설이다.

## 가설

1. **import machinery가 preopen FS 위에서 돈다.** `sys.path`에 preopen 디렉터리를 넣으면 CPython의 path-based finder가 그 디렉터리의 `.py`를 찾아 import한다. (WLR 빌드는 stdlib를 wasm에 frozen으로 심어 부팅하므로, path finder가 preopen을 실제로 stat/listdir하는지가 미확정 = 실측 대상.)
2. **중첩 패키지가 된다.** `pkg/__init__.py` + 서브모듈 디렉터리 구조(shim `Directory`)를 CPython이 패키지로 인식한다.
3. **진짜 wheel이 end-to-end로 돈다.** 순수 파이썬 wheel을 fetch -> 네이티브 `DecompressionStream`(의존성 0)으로 unzip -> preopen에 마운트 -> import -> 실사용.
4. **라이브 세션에 post-boot 마운트가 된다.** 부팅된 인터프리터에 패키지를 나중에 얹고(=pip 등가) import한다. 경계 메타 신호로 preopen `Directory` 내용을 갱신한다.

## 졸업 게이트 (승격 조건)

- 위 4가지가 브라우저 실측 GREEN. 특히 3(진짜 wheel)과 4(post-boot)가 "패키지 생태계가 WASI에서 산다"의 증명점.
- 정직한 벽 기록: C 확장 wheel(numpy 등)은 실패해야 정상이다(WASI 동적 링크 부재, PEP 783 대기). 그 경계를 실측으로 특정한다.

## 승격 경로

성립 시 `WasiSession`에 패키지 마운트 능력을 additive로 얹는다: `bootWasi({ packages })`(부팅 시) + `session.mountPackage(name, files)` / `session.installWheel(bytes)`(라이브). ZIP 리더(네이티브 DecompressionStream)는 src 유틸로 승격. 값 다리(JSON 한정)는 불변 - 패키지는 파일 채널이라 FFI와 무관.

## 자산 정책

wasm(WLR 3.12, 26MB) + shim은 [enginePort](../enginePort/)에서 참조(레포 미추적). wheel은 이 폴더에 두되 미추적(gitignore `*.whl`). wasiGate가 same-origin으로 읽고, 없으면 SKIP(자산 없어도 게이트 green). 재현:

```
python -m pip download six==1.17.0 packaging==26.2 --no-deps --only-binary=:all: -d tests/attempts/wasiPackages/
```

## 결과 (2026-07-13, Edge headless / 로컬 COOP+COEP)

프로브 GREEN 9/9(부팅 52ms, unzip 27ms):

- **① 단일 모듈**: 손수 만든 `greetings.py`를 /site에 얹고 `sys.path.insert(0, "/site")` -> `import greetings` 성립. import machinery가 preopen FS 위에서 돈다(WLR 빌드는 stdlib를 frozen으로 심지만 path-based finder는 preopen을 실제로 stat/listdir 한다).
- **② 중첩 패키지**: `mypkg/__init__.py` + `mypkg/util.py`를 shim `Directory` 트리로 -> `import mypkg` + 서브모듈 성립.
- **③ post-boot 라이브 설치**: 파이썬이 `open("/site/x.py","w")`로 파일을 쓰고(= preopen 쓰기 가능) `importlib.invalidate_caches()` 후 즉시 import. **"pip install을 라이브 세션에"가 기계적으로 가능** = installWheel의 근거.
- **④⑤ 진짜 wheel**: `six`(단일 모듈) + `packaging`(다중 파일, stdlib만 의존)을 fetch -> 네이티브 `DecompressionStream`으로 unzip(의존성 0) -> /site 마운트 -> `import six`(1.17.0) / `packaging.version.Version` 비교(실작업) 성립.
- **⑥ 정직한 벽**: `importlib.machinery.EXTENSION_SUFFIXES == []`. **C 확장은 구조적으로 import 불가**(WASI 동적 링크 부재, PEP 783 대기). 조용한 성공/크래시가 아니라 명시적 부재로 경계를 못박음.

파일은 shim(JS) 쪽에 살아 wasm 힙 밖 = 시간여행 스냅샷과 독립(패키지는 안정 상태). 값 다리(JSON 한정)와 무관 - 패키지는 파일 채널이라 FFI가 필요 없다.

**의미**: "Pyodide를 뗀다"가 부팅/결정성/반복실행/값프로토콜/완전 시간여행에 이어 **패키지 생태계(순수 파이썬)**까지 non-Pyodide에서 성립. Pyodide 급의 "진짜 파이썬"에 한 걸음. 남은 간극 = C 확장(PEP 783 대기).
