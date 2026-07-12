# wasiReplDriver.py - pyproc이 소유하는 파이썬 엔진 드라이버(WASI CPython 위 반복 실행 REPL).
# 외부 CPython(WASI 바이너리)은 참조만 하고, 그 위에서 "인터프리터를 세워두고 코드 조각을
# N회 실행"하게 만드는 엔진 로직은 pyproc이 정본으로 소유한다(SSOT). 승격 위치 후보:
# src/runtime/engines/wasi/. camelCase 규칙은 언어 불문(파이썬 식별자도 camelCase).
#
# 값 다리(WASI엔 FFI 없음): stdin으로 base64 소스를, stdout으로 결과를 주고받는 값 프로토콜.
#   실행  = base64(코드) 한 줄 -> exec
#   set   = 'name = <json>' 코드로 전역 주입
#   get   = 'print(json.dumps(name))' 코드로 stdout 회수
# 한 왕복의 끝은 EOT(\x04) 한 줄. 호출자는 그 줄까지를 한 실행의 출력으로 본다.
#
# 실측 주의(WLR CPython 3.12 프리빌트): 반복 루프 프레임 위에서 명시적 compile()을 호출하면
# wasm C 스택을 넘겨 "memory access out of bounds"로 죽는다(driverFileProbe로 특정). exec(str)의
# 내부 컴파일은 C 레벨이라 안전하므로 exec(소스문자열)을 직접 쓴다(명시적 compile 금지).
import sys
import base64

userNs = {}
while True:
    inputLine = sys.stdin.readline()
    if not inputLine:
        break
    inputLine = inputLine.strip()
    if inputLine:
        try:
            exec(base64.b64decode(inputLine).decode(), userNs)
        except BaseException as execError:
            sys.stderr.write(repr(execError) + "\n")
            sys.stderr.flush()
    sys.stdout.write("\x04\n")
    sys.stdout.flush()
