// kernelSession.js - Layer 4: loader-neutral session lifecycle over KernelFactory.
import { PyProcError } from "../runtime/errors.js";
import { decodeValueEnvelope } from "../runtime/kernel/valueEnvelope.js";

// 실행 한 번이 print 출력과 마지막 식의 repr을 함께 돌려준다(REPL 의미론). 마지막 문장이 식이면 그 값의 repr이
// value가 되고(None은 null), 코드가 stderr에 쓴 글은 순서대로 output에 합쳐 예외만 실패로 남긴다. helper는
// 네임스페이스에 상주시키지 않고 호출마다 넣는다: checkpoint 복원이 상주 helper를 지울 수 있기 때문이다. 소스는
// JSON 문자열로 넣는다(JSON 문자열 표기는 그대로 Python 문자열 literal이다). 실측: tests/attempts/runtimeParity/cellValueProbe.mjs
const CELL_VALUE_NAME = "pyprocCellValue";
const CELL_HELPER = [
  "def pyprocCell(pyprocSource):",
  "    import ast as pyprocAst, contextlib as pyprocContext, sys as pyprocSys",
  "    tree = pyprocAst.parse(pyprocSource, '<string>', 'exec')",
  "    tail = None",
  "    if tree.body and isinstance(tree.body[-1], pyprocAst.Expr):",
  "        tail = pyprocAst.Expression(tree.body.pop().value)",
  "    with pyprocContext.redirect_stderr(pyprocSys.stdout):",
  "        exec(compile(tree, '<string>', 'exec'), globals())",
  "        value = None if tail is None else eval(compile(tail, '<string>', 'eval'), globals())",
  "    return None if value is None else repr(value)",
].join("\n");

function cellSource(code) {
  return `${CELL_HELPER}\ntry:\n    ${CELL_VALUE_NAME} = pyprocCell(${JSON.stringify(code)})\nfinally:\n    del pyprocCell\n`;
}

export class KernelSession {
  #factory;
  #kernel;
  #closed = false;

  constructor(factory, kernel) {
    if (!factory || typeof factory.open !== "function" || !kernel || typeof kernel.execute !== "function") {
      throw new PyProcError("PYPROC_INPUT_INVALID", "KernelSession requires a KernelFactory and v2 kernel");
    }
    this.#factory = factory;
    this.#kernel = kernel;
  }

  static async open(factory, manifest, options = {}) {
    return new KernelSession(factory, await factory.open(manifest, options));
  }

  get kernel() { return this.#kernel; }
  get factory() { return this.#factory; }

  async run(code, options = {}) {
    if (this.#closed) throw new PyProcError("PYPROC_PROCESS_UNAVAILABLE", "KernelSession is closed");
    if (typeof code !== "string") throw new PyProcError("PYPROC_INPUT_INVALID", "KernelSession.run requires Python source text");
    const result = await this.#kernel.execute({ ...options, code: cellSource(code) });
    if (result.state !== "completed") {
      throw new PyProcError("PYPROC_KERNEL_EXECUTION_ERROR", result.error?.message || "Kernel execution failed", {
        context: { kernelError: result.error || null },
      });
    }
    return Object.freeze({ ...result,
      output: result.stdout.map((entry) => entry.text).join("\n"),
      value: await this.get(CELL_VALUE_NAME) });
  }

  async get(name) {
    return decodeValueEnvelope((await this.#kernel.getValue({ name })).value);
  }

  set(name, value) { return this.#kernel.setValue({ name, value }); }

  checkpoint(request = {}) { return this.#factory.checkpoint(this.#kernel, request); }

  restore(checkpoint) {
    const checkpointRef = typeof checkpoint === "string" ? checkpoint : checkpoint?.checkpointRef;
    if (!checkpointRef) throw new PyProcError("PYPROC_INPUT_INVALID", "KernelSession.restore requires a checkpoint");
    return this.#kernel.restore({ checkpointRef, ...(typeof checkpoint === "object" ? { checkpoint } : {}) });
  }

  async fork(options = {}) {
    const cloned = await this.#factory.clone(this.#kernel, options);
    return Object.freeze({ session: new KernelSession(this.#factory, cloned.kernel), checkpoint: cloned.checkpoint });
  }

  exportImage(options = {}) { return this.#factory.exportImage(this.#kernel, options); }

  describe() { return this.#kernel.describe(); }

  async close() {
    if (this.#closed) return Object.freeze({ state: "closed" });
    this.#closed = true;
    return this.#kernel.close();
  }
}
