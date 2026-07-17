// shardCompute.js - Layer 3: 배열 연산을 프로세스 풀에 샤딩한다.
//
// pyProc의 map(프로세스 스케줄링) 위에 얹힌 수치 레인이다. 프로세스 테이블도 RPC도 fork도
// 만지지 않고 map과 풀 크기만 쓴다. pyProc이 이걸 품고 있으면 "프로세스 수명주기"와
// "numpy 블록 분할"이 한 파일에서 같은 이유로 바뀌는 척을 하게 된다.
//
// 정직: 여기 배속은 compute-bound 커널(N^3)의 것이다. memory-bound op(리덕션/값싼 원소별)는
// 전송 O(n)과 연산 O(n)이 같은 차수라 배속이 modest하고, 작은 배열은 전송비로 진다
// (numericShard/shardOpsProbe 실측).
import { PyProcError } from "../runtime/errors.js";

// TypedArray를 SharedArrayBuffer로 1회 복사(제로카피 불가 = memcpy 1회 계약).
function toSab(typed) {
  const sab = new SharedArrayBuffer(typed.byteLength);
  new Uint8Array(sab).set(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength));
  return sab;
}

function resolveShardParts(rawParts, maxParts, label) {
  if (!Number.isInteger(maxParts) || maxParts < 1) throw new PyProcError("PYPROC_PROCESS_UNAVAILABLE", `${label}: 준비된 워커 없음(boot 먼저)`);
  if (rawParts === undefined || rawParts === null) return maxParts;
  if (!Number.isInteger(rawParts) || rawParts < 1) throw new PyProcError("PYPROC_INPUT_INVALID", `${label}: parts는 양의 정수여야 한다`);
  return Math.min(rawParts, maxParts);
}

const DTYPE_OF = {
  Float64Array: "float64", Float32Array: "float32", Int32Array: "int32", Uint32Array: "uint32",
  Int16Array: "int16", Uint16Array: "uint16", Int8Array: "int8", Uint8Array: "uint8",
};

// matmul 워커 파이썬: arg의 SAB에서 A블록(mp x k)과 전체 B(k x n)를 numpy로 재구성해 C_p = A_p @ B를
// 계산하고, 공유 출력 SAB의 자기 행블록 위치(outOff)에 바이트로 쓴다. SAB는 to_py/frombuffer가
// 직접 못 쓰므로 입력은 .slice()로 워커 로컬 복사, 출력은 pyodide TypedArray.assign(파이썬 버퍼)로
// 공유 뷰에 직접 복사(assign은 파이썬 bytes/memoryview를 버퍼 프로토콜로 받는다).
const MATMUL_FN = [
  "def _fn(arg):",
  "    import js, numpy",
  "    mp = arg.mp; k = arg.k; n = arg.n",
  "    a = numpy.frombuffer(js.Uint8Array.new(arg.aSab, arg.aOff, mp * k * 8).slice().to_py(), dtype='float64').reshape(mp, k)",
  "    b = numpy.frombuffer(js.Uint8Array.new(arg.bSab, 0, k * n * 8).slice().to_py(), dtype='float64').reshape(k, n)",
  "    c = numpy.ascontiguousarray(a @ b)",
  "    js.Uint8Array.new(arg.outSab, arg.outOff, mp * n * 8).assign(c.view(numpy.uint8).reshape(-1))",
  "    return 1",
].join("\n");

// TypedArray를 파트로 쪼개 각 워커가 numpy 뷰로 자기 조각만 본다(SAB면 복사 0).
// map: (fnSrc, args, opts) => Promise<결과 배열>. poolSize: 준비된 워커 수.
export function shardMapArray(map, poolSize, fnSrc, typed, opts = {}) {
  const parts = resolveShardParts(opts.parts, poolSize, "mapArray");
  const dtype = DTYPE_OF[typed.constructor.name];
  if (!dtype) throw new PyProcError("PYPROC_INPUT_INVALID", `mapArray: 지원하지 않는 TypedArray(${typed.constructor.name})`);
  let sab = typed.buffer, base = typed.byteOffset;
  if (!(sab instanceof SharedArrayBuffer)) { // SAB가 아니면 1회 복사로 전 워커 공유화
    sab = toSab(typed);
    base = 0;
  }
  const bpe = typed.BYTES_PER_ELEMENT, per = Math.floor(typed.length / parts);
  const metas = Array.from({ length: parts }, (_, i) => {
    const start = i * per, count = i === parts - 1 ? typed.length - start : per;
    return { sab, off: base + start * bpe, len: count * bpe, dtype };
  });
  const harness = fnSrc.replace("def _fn(", "def _pyprocUser(") + "\n"
    + "def _fn(meta):\n"
    + "    import js, numpy\n"
    + "    _u8 = js.Uint8Array.new(meta.sab, meta.off, meta.len).slice()\n"
    + "    return _pyprocUser(numpy.frombuffer(_u8.to_py(), dtype=meta.dtype))\n";
  return map(harness, metas, opts);
}

// 샤딩 matmul: C = A@B를 A의 행블록으로 P분할, 워커 p가 C_p = A_p @ B를 계산해 공유 출력 SAB에
// 자기 행블록으로 쓴다(B는 워커당 memcpy 1회 복제). compute-bound(N^3)이라 near-linear 배속:
// 실측(numericShard/shardMatmulProbe) 4워커 3.67배(92% 효율), 전송 오버헤드 무시 가능(14ms).
// numpy 필요: new PyProc({ packages: ["numpy"], setup: "import numpy" }).
// a/b = { data: Float64Array, rows, cols }. 반환 { data: Float64Array, rows: a.rows, cols: b.cols }.
// opts.parts: 샤딩할 워커 수 상한(기본 = 풀 전체). parts:1이면 단일워커 대조(같은 코드 경로 =
// 공정한 배속 비교의 baseline). 그 외 소비자는 생략(전 코어 활용).
export async function shardMatmul(map, poolSize, a, b, opts = {}) {
  if (!a || !b || !a.data || !b.data) throw new PyProcError("PYPROC_INPUT_INVALID", "matmul: a/b는 { data: Float64Array, rows, cols }");
  if (!(a.data instanceof Float64Array) || !(b.data instanceof Float64Array)) throw new PyProcError("PYPROC_INPUT_INVALID", "matmul: data는 Float64Array(f64 = numpy 기본)");
  if (![a.rows, a.cols, b.rows, b.cols].every((n) => Number.isInteger(n) && n > 0)) throw new PyProcError("PYPROC_INPUT_INVALID", "matmul: rows/cols는 양의 정수여야 한다");
  if (a.cols !== b.rows) throw new PyProcError("PYPROC_INPUT_INVALID", `matmul: 차원 불일치 (${a.rows}x${a.cols}) @ (${b.rows}x${b.cols})`);
  if (a.data.length !== a.rows * a.cols || b.data.length !== b.rows * b.cols) throw new PyProcError("PYPROC_INPUT_INVALID", "matmul: data 길이가 rows*cols와 불일치");
  if (!poolSize) throw new PyProcError("PYPROC_PROCESS_UNAVAILABLE", "matmul: 준비된 워커 없음(boot 먼저)");
  const M = a.rows, K = a.cols, N = b.cols;
  const P = resolveShardParts(opts.parts, Math.min(poolSize, M), "matmul");
  // A, B, 출력 C를 SAB로(공유). A/B 입력은 memcpy 1회로 SAB화(계약: 제로카피 불가).
  const aSab = toSab(a.data), bSab = toSab(b.data), outSab = new SharedArrayBuffer(M * N * 8);
  const per = Math.floor(M / P);
  const metas = Array.from({ length: P }, (_, i) => {
    const startRow = i * per, rows = i === P - 1 ? M - startRow : per;
    return { aSab, aOff: startRow * K * 8, mp: rows, k: K, n: N, bSab, outSab, outOff: startRow * N * 8 };
  }).filter((m) => m.mp > 0);
  const res = await map(MATMUL_FN, metas, opts);
  const bad = res.find((r) => r && r.error);
  if (bad) throw new PyProcError("PYPROC_WORKER_TASK_ERROR", "matmul: 워커 실패 " + bad.error);
  return { data: new Float64Array(outSab), rows: M, cols: N };
}
