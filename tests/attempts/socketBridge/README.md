# socketBridge - 브라우저에서 진짜 소켓 (벽2)

## 개념 캠페인

질문: **브라우저 탭의 파이썬이 임의 host:port로 진짜 TCP 소켓을 열 수 있는가** (HTTP fetch 근사가 아니라 `socket`/`requests`/`urllib3`가 원하는 소켓 층).

물리: 탭은 raw 소켓(`socket()/connect()`)을 못 연다. 하지만 밖으로 다이얼하는 WebSocket은 연다. 그래서 아웃바운드 진짜 TCP는 **얇은 릴레이**(진짜 NIC를 만지는 외부 조각)로만 가능하다. 인바운드(탭이 공개 서버)는 외부 컴포넌트 없이는 물리적으로 불가(역터널 릴레이 필요). 리서치 정본: 웹 python-runtime 원장 2026-07-13 벽2 절.

## 가설

1. 얇은 WS->TCP 릴레이(의존성 0)로 브라우저에서 임의 host:port에 진짜 TCP 왕복이 된다.
2. 파이썬 소켓의 어려운 절반(**블로킹 `recv()`를 비동기 전송 위에서**)이 pyproc이 이미 쓰는 SAB+Atomics로 성립한다(= 새 엔진 문제가 아니라 능력 배선).

## 졸업 게이트

- 브라우저에서 raw 바이트가 릴레이를 통해 실제 TCP로 왕복(HTTP 어댑터가 아니라 소켓 층 원문) = pass/fail
- 워커에서 **동기** connect/send/recv 완주(recv가 진짜 블로킹) = pass/fail
- 승격 시: 파이썬 `socket` 모듈을 이 브리지에 배선(Pyodide 소켓 패치 / WASI 소켓), 릴레이 계약을 소비자 교체 가능하게(Wisp 프로토콜 멀티플렉싱은 v2).

## 자산 / 재현

- `relay.mjs` = zero-dep WS->TCP 릴레이(RFC 6455 핸드셰이크+프레이밍을 node:crypto/net으로 직접). 기동: `node tests/attempts/socketBridge/relay.mjs 8791`. 소비자 교체 가능(Wisp/websockify/자체).
- probe는 릴레이 미기동 시 SKIP(게이트 green). 진짜 네트워크(example.com:80)를 타므로 CI 상시 실행 아님(수동/로컬 실측).

## 결과 (2026-07-13, Edge headless / 로컬 COOP+COEP + 릴레이)

- **socketProbe GREEN 3/3**: 브라우저 -> WS -> 릴레이 -> `example.com:80` raw HTTP/1.0 -> **`HTTP/1.1 200 OK` 828바이트 원문**(헤더+`<html>` 바디, 소켓 층 그대로), 왕복 143ms. 임의 host:port 다이얼도 진짜(닫힌 127.0.0.1:9 -> `ECONNREFUSED` 소켓 에러 전달).
- **socketBlockingProbe GREEN 2/2**: 워커에서 **동기 `connect/send/recv`**(블로킹 recv를 Atomics.wait으로) 완주, `HTTP/1.1 200 OK` 828바이트, 118ms. 파이썬 `socket.recv()`의 동기 의미가 비동기 WS 위에서 성립.

- **socketPyProbe GREEN 2/2**: **진짜 파이썬(Pyodide)이 소켓을 연다.** 파이썬 `socket.socket()`을 릴레이 소켓으로 심하고(Python->js.bridge* 동기 호출, 블로킹 recv는 워커 Atomics.wait), Python 코드 `sock.connect(('example.com',80)); sock.sendall(b'GET...'); sock.recv()`가 `HTTP/1.1 200 OK` 828바이트 `<html>` 바디를 받는다(총 3864ms, 대부분 Pyodide 부팅). JS가 아니라 파이썬이 진짜 인터넷 바이트를 받는다. `requests`/`urllib3`/`http.client`가 같은 socket API라 이 심을 그대로 쓴다(makefile 등 확장은 v2).

- **socketCapProbe GREEN 3/3 (src 능력 승격, http + https)**: `Runtime.enableSocketBridge({relayURL})`로 승격. 메인 스레드 Runtime에서 파이썬 socket.socket()/create_connection을 릴레이에 심하고(블로킹 recv = JSPI/run_sync, runAsync 경로), **`urllib.request.urlopen`이 진짜 소켓으로 HTTP 200**(`http://example.com/` 559바이트 516ms) **와 HTTPS 200**(`https://example.com/` 219ms)을 수신. HTTPS는 릴레이가 port 443에서 TLS 종단하고 파이썬 `ssl.SSLContext.wrap_socket`은 패스스루(이중 암호화 방지). http.client가 심한 socket(create_connection + makefile)을 그대로 써서 진짜 TCP로 왕복. **파이썬 HTTP 스택이 브라우저에서 진짜 소켓으로 http + https 둘 다 돈다.**
  - 실측 특정 버그: http.client는 `Connection: close` 응답에서 헤더만 읽고 소켓을 닫은 뒤 바디를 makefile로 읽는다(CPython 소켓은 refcount로 생존). `close()`가 즉시 WS를 닫으면 릴레이가 in-flight 응답을 끊어 truncation(IncompleteRead 559바이트). `close()`를 유예해 데이터 드레인이 끝나게 해결.

**의미**: 벽2 아웃바운드가 개념 -> 진짜 파이썬 소켓 -> **src 능력(http + https)**으로 완결됐다. `SocketBridge`가 공개 표면. 남은 것 = 릴레이 강화(Wisp 멀티플렉싱, in-tab TLS = e2e), requests/urllib3(urllib3의 ssl 속성 추가 심). 인바운드는 정직한 물리 벽으로 남는다(역터널 릴레이 = 별도 조각).
