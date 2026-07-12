# wasiReplDriver.py - pyproc이 소유하는 파이썬 엔진 드라이버(WASI CPython 위 반복 실행 REPL).
# 외부 CPython(WASI 바이너리)은 참조만 하고, 그 위에서 "인터프리터를 세워두고 코드 조각을
# N회 실행"하게 만드는 엔진 로직은 pyproc이 정본으로 소유한다(SSOT). 승격 위치 후보:
# src/runtime/engines/wasi/. camelCase 규칙은 언어 불문(파이썬 식별자도 camelCase).
#
# 값 다리(WASI엔 FFI 없음): stdin으로 base64 소스를, stdout으로 결과를 주고받는 값 프로토콜.
#   실행  = base64(코드) 한 줄 -> exec
#   set   = 'name = <json>' 코드로 전역 주입
#   get   = 'print(json.dumps(name))' 코드로 stdout 회수
# 한 왕복의 끝은 EOT(\x04) 한 줄.
#
# 실측 주의 1(WLR CPython 3.12 프리빌트): 반복 루프 프레임 위에서 명시적 compile()을 호출하면
# wasm C 스택을 넘겨 "memory access out of bounds"로 죽는다. exec(str)의 내부 컴파일은 C
# 레벨이라 안전하므로 exec(소스문자열)을 직접 쓴다(명시적 compile 금지).
# 실측 주의 2(힙 시간여행): sys.stdin(io.BufferedReader)은 내부 버퍼를 힙에 두어, 힙 복원이
# 그 버퍼까지 되돌려 "복원 후 재개"가 깨진다. os.read/os.write(unbuffered)로 직접 읽고 쓰면
# 파이썬측 I/O 상태가 없어, 경계(입력 대기)에서 찍은 스냅샷으로 복원해도 재개가 일관된다.
import os
import base64

userNs = {}


def readCommandLine():
    data = bytearray()
    while True:
        chunk = os.read(0, 1)  # unbuffered: 파이썬측 버퍼 상태를 남기지 않는다(복원 안전)
        if not chunk or chunk == b"\n":
            break
        data += chunk
    return bytes(data)


while True:
    commandLine = readCommandLine()
    if not commandLine:
        break
    try:
        exec(base64.b64decode(commandLine).decode(), userNs)
    except BaseException as execError:
        os.write(2, (repr(execError) + "\n").encode())
    os.write(1, b"\x04\n")
