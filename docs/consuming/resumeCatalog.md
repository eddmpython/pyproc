# resume.py 자원 정책 카탈로그

`Session.load`, `MachineJournal.recover`, `openMachine`은 파이썬 힙과 `/home/web` 파일 바이트를 되살린다. 그러나 열린 파일 핸들, SQLite connection, WebSocket/relay connection, 브라우저 장치 권한, DOM callback 같은 프로세스 바깥 자원은 힙 델타만으로 보장하지 않는다. 이 문서는 제품이 `/home/web/resume.py`에 무엇을 넣어야 하는지의 카탈로그다.

## 공통 계약

- 기본 위치는 `/home/web/resume.py`다. 다른 경로가 필요하면 `rt.enableInit({ resumePath })`로 명시한다.
- 부활 뒤 소비자가 `rt.enableInit().resume(reason)`을 호출한다. `reason`은 `resume.py` 안에서 전역 `pyprocResumeReason`으로 읽는다.
- 같은 파일은 여러 번 실행될 수 있으므로 idempotent여야 한다. 테이블 생성, 디렉터리 생성, 캐시 재구성은 `if not exists`와 재시도 가능 구조로 쓴다.
- 다시 열 대상은 "힙에 객체가 남아 보여도 플랫폼 상태가 사라질 수 있는 것"이다: SQLite connection, 열린 파일 핸들, SocketBridge/relay 세션, ASGI 앱 전역 DB connection, 브라우저 장치 handle, 외부 권한 토큰의 메모리 캐시.
- `/home/web`에 영속된 파일과 명시 설정을 정본으로 삼고, stale Python object는 신뢰하지 않는다.
- 권한 요청은 제품 UI가 소유한다. `resume.py`가 카메라, 네트워크 relay, clipboard 같은 권한을 조용히 다시 열면 안 된다.
- 장시간 package install이나 네트워크 fetch를 `resume.py`에 넣지 않는다. 부활 경로는 빠르게 수렴해야 한다.

권장 reason 값:

| reason | 언제 |
|---|---|
| `fresh.boot` | 제품이 첫 부팅에서도 같은 hook으로 자원을 여는 경우 |
| `session.load` | `Session.load(dir, name)` 뒤 |
| `journal.recover` | `MachineJournal.recover()` 뒤 |
| `openMachine` | `openMachine(blob, trustOptions)` 뒤 |
| `kernel.failover` | 탭 리더 교체 뒤 follower가 저널에서 되살아난 경우 |

## 현재 고정된 표면

| 표면 | 상태 | resume.py 정책 | 검증 |
|---|---|---|---|
| `tests/attempts/pythonMachine/resumeHookProbe.html` | 계약 probe | sqlite connection을 `resumeConn`으로 다시 열고 reason/value를 기록한다. `Session.load`, `MachineJournal.recover`, `openMachine` 세 경로와 파일 없음 no-op을 검증한다 | `node tests/browser/run.mjs tests/attempts/pythonMachine/resumeHookProbe.html` |
| `examples/machine.html` | 실제 데모 표면 | 첫 부팅 또는 부활 뒤 `/home/web/resume.py`가 `appDb` SQLite connection을 열고 `resumeEvent`에 reason을 남긴다. signed `.pymachine` cast 후 `openMachine`에서도 같은 hook을 실행한다 | `npm run test:examples`, 또는 `node tests/browser/run.mjs examples/machine.html?gate=1` |

## 제품별 적용 정책

| 제품 | 재개설 대상 | resume.py에 둬야 할 것 | pyproc 쪽 판정 |
|---|---|---|---|
| codaro | 셀 실행 기록, `/home/web/codaro` 산출물 index, ASGI 개발 서버가 잡는 DB/file connection | `/home/web/codaro` 파일 트리를 정본으로 삼고, SQLite/index connection과 ASGI app 전역 connection을 다시 연다. 셀별 PyProxy, DOM handle, editor callback은 저장하지 않는다 | 다음 제품 소비 축에서 `.pymachine` 또는 `VirtualOrigin` 채택 시 gate로 고정 |
| dartlab | notebook worker의 ASGI `/pyapi`, sqlite/파일 connection, 패키지 캐시 index | 자체 부팅 Pyodide를 `Runtime`으로 채택한 뒤, DB connection과 app state adapter를 `/home/web` 기준으로 다시 연결한다. FastAPI route 함수 자체보다 외부 connection 재개설이 핵심이다 | pyproc 계약은 준비됨. dartlab 채택 시 제품 gate 필요 |
| xlpod | 스프레드시트 UDF 캐시, formula bridge callback, 취소 SAB, workbook별 산출물 | workbook 식별자와 `/home/web/xlpod` 산출물을 정본으로 삼고, callback/SAB/worksheet bridge는 힙에서 재사용하지 않고 호스트에서 다시 주입한다 | UDF 동기 브리지 채택 시 별도 gate 필요 |
| 일반 외부 제품 | 사용자 파일, 로컬 DB, relay/session token, device permission | `/home/web/<app>` 아래 manifest를 두고 resume.py는 그 manifest만 읽어 connection을 다시 만든다. 권한이 필요한 자원은 먼저 UI 승인 상태를 확인한다 | 소비 계약으로 공개. 제품별 증거는 각 제품 gate에서 요구 |

## 최소 템플릿

```python
import os, sqlite3

os.makedirs("/home/web/myApp", exist_ok=True)
resumeReasonSeen = pyprocResumeReason
appDbPath = "/home/web/myApp/app.db"
appDb = sqlite3.connect(appDbPath)
appDb.execute("create table if not exists resumeEvent(reason text)")
appDb.execute("insert into resumeEvent(reason) values (?)", (resumeReasonSeen,))
appDb.commit()
```

제품은 이 템플릿을 그대로 복사하지 말고, 자기 자원 목록을 기준으로 얇게 유지한다. 핵심은 "힙에 남은 객체를 믿지 않고 `/home/web`의 파일과 명시 권한으로 다시 연다"는 점이다.
