// cpythonWasiGuestAdapter.js - WebMachine guest backed by the owned KernelMachine contract.
import { bootDefaultKernelMachine, openDefaultKernelMachineImage }
  from "../../composition/kernelMachine.js";
import { WebMachineError } from "../../contracts/webMachineError.js";
import { throwIfOperationAborted } from "../../contracts/operationControl.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const GUEST_IMAGE_PROTOCOL = "pyproc.cpython-wasi-guest-image";
const GUEST_IMAGE_VERSION = 1;
const HOME_MAX_FILES = 2048;
const HOME_MAX_BYTES = 2 * 1024 * 1024;
const RUN_HARNESS = [
  "import ast as _webAst, contextlib as _webCtx, io as _webIo, json as _webJson",
  "_webTree = _webAst.parse(_webSource, '<web-computer>', 'exec')",
  "_webLast = _webTree.body[-1] if _webTree.body and isinstance(_webTree.body[-1], _webAst.Expr) else None",
  "_webPrefix = _webAst.Module(body=_webTree.body[:-1] if _webLast else _webTree.body, type_ignores=[])",
  "_webBuffer = _webIo.StringIO()",
  "_webValue = None",
  "with _webCtx.redirect_stdout(_webBuffer), _webCtx.redirect_stderr(_webBuffer):",
  "    exec(compile(_webPrefix, '<web-computer>', 'exec'), globals())",
  "    if _webLast:",
  "        _webValue = eval(compile(_webAst.Expression(_webLast.value), '<web-computer>', 'eval'), globals())",
  "try:",
  "    _webJson.dumps(_webValue)",
  "    _webSerializable = _webValue",
  "except TypeError:",
  "    _webSerializable = repr(_webValue)",
  "print(_webJson.dumps({'stdout': _webBuffer.getvalue(), 'value': _webSerializable}, ensure_ascii=False))",
].join("\n");
const CAPTURE_HOME_HARNESS = [
  "import base64 as _webBase64, os as _webOs",
  `_webHomeMaxFiles = ${HOME_MAX_FILES}`,
  `_webHomeMaxBytes = ${HOME_MAX_BYTES}`,
  "_webHomeSnapshot = []",
  "_webHomeBytes = 0",
  "if _webOs.path.isdir('/home'):",
  "    for _webDir, _webDirs, _webFiles in _webOs.walk('/home', topdown=True, followlinks=False):",
  "        _webDirs.sort(); _webFiles.sort()",
  "        for _webName in list(_webDirs):",
  "            _webPath = _webOs.path.join(_webDir, _webName)",
  "            if _webOs.path.islink(_webPath): raise RuntimeError('home snapshot does not allow links')",
  "            _webRel = _webOs.path.relpath(_webPath, '/home').replace('\\\\', '/')",
  "            _webHomeSnapshot.append({'path': _webRel, 'kind': 'directory'})",
  "        for _webName in _webFiles:",
  "            _webPath = _webOs.path.join(_webDir, _webName)",
  "            if _webOs.path.islink(_webPath): raise RuntimeError('home snapshot does not allow links')",
  "            with open(_webPath, 'rb') as _webFile: _webBytes = _webFile.read(_webHomeMaxBytes + 1)",
  "            _webHomeBytes += len(_webBytes)",
  "            if _webHomeBytes > _webHomeMaxBytes: raise RuntimeError('home snapshot byte limit exceeded')",
  "            _webRel = _webOs.path.relpath(_webPath, '/home').replace('\\\\', '/')",
  "            _webHomeSnapshot.append({'path': _webRel, 'kind': 'file', 'base64': _webBase64.b64encode(_webBytes).decode('ascii')})",
  "        if len(_webHomeSnapshot) > _webHomeMaxFiles: raise RuntimeError('home snapshot file limit exceeded')",
].join("\n");
const RESTORE_HOME_HARNESS = [
  "import base64 as _webBase64, binascii as _webBinascii, os as _webOs, pathlib as _webPathlib",
  `_webHomeMaxFiles = ${HOME_MAX_FILES}`,
  `_webHomeMaxBytes = ${HOME_MAX_BYTES}`,
  "if not isinstance(_webHomeSnapshot, list) or len(_webHomeSnapshot) > _webHomeMaxFiles:",
  "    raise RuntimeError('home snapshot entry limit exceeded')",
  "_webSeen = set(); _webHomeBytes = 0",
  "for _webEntry in _webHomeSnapshot:",
  "    if not isinstance(_webEntry, dict) or set(_webEntry) - {'path', 'kind', 'base64'}:",
  "        raise RuntimeError('home snapshot entry is invalid')",
  "    _webRel = _webEntry.get('path')",
  "    _webParts = _webPathlib.PurePosixPath(_webRel).parts if isinstance(_webRel, str) else ()",
  "    if not _webParts or _webRel.startswith('/') or any(_webPart in ('', '.', '..') for _webPart in _webParts) or _webRel in _webSeen:",
  "        raise RuntimeError('home snapshot path is invalid')",
  "    _webSeen.add(_webRel)",
  "    _webTarget = _webOs.path.join('/home', *_webParts)",
  "    if _webEntry.get('kind') == 'directory':",
  "        _webOs.makedirs(_webTarget, exist_ok=True)",
  "    elif _webEntry.get('kind') == 'file' and isinstance(_webEntry.get('base64'), str):",
  "        try: _webBytes = _webBase64.b64decode(_webEntry['base64'], validate=True)",
  "        except _webBinascii.Error as _webError: raise RuntimeError('home snapshot base64 is invalid') from _webError",
  "        _webHomeBytes += len(_webBytes)",
  "        if _webHomeBytes > _webHomeMaxBytes: raise RuntimeError('home snapshot byte limit exceeded')",
  "        _webOs.makedirs(_webOs.path.dirname(_webTarget), exist_ok=True)",
  "        with open(_webTarget, 'wb') as _webFile: _webFile.write(_webBytes)",
  "    else:",
  "        raise RuntimeError('home snapshot kind is invalid')",
].join("\n");

function consoleWrite(context, message) {
  context.devices.console?.write?.(String(message));
}

export function createCpythonWasiGuestFactory({
  bootMachine = bootDefaultKernelMachine,
  openMachineImage = openDefaultKernelMachineImage,
} = {}) {
  if (typeof bootMachine !== "function") throw new TypeError("a bootMachine function is required");
  if (typeof openMachineImage !== "function") throw new TypeError("an openMachineImage function is required");
  return () => new CpythonWasiGuestAdapter({ bootMachine, openMachineImage });
}

class CpythonWasiGuestAdapter {
  constructor({ bootMachine, openMachineImage }) {
    this._bootMachine = bootMachine;
    this._openMachineImage = openMachineImage;
    this._machine = null;
    this._context = null;
    this._checkpoints = [];
    this.capabilities = Object.freeze({
      adapterVersion: "cpython-wasi-kernel-v1",
      snapshotScope: "portable",
      pauseMode: "cooperative",
      shutdownMode: "release",
      requiredDevices: Object.freeze([{ name: "console", kind: "console" }]),
    });
  }

  async boot(context, manifest = {}, control) {
    throwIfOperationAborted(control, `${context.machineId}: kernel boot`);
    this._context = context;
    this._machine = await this._bootMachine(manifest.kernel || {});
    throwIfOperationAborted(control, `${context.machineId}: kernel boot`, { outcomeUnknown: true });
    consoleWrite(context, `kernel:boot:${context.machineId}`);
  }

  async pause(control) {
    throwIfOperationAborted(control, "kernel pause");
    consoleWrite(this._context, "kernel:pause");
  }

  async resume(control) {
    throwIfOperationAborted(control, "kernel resume");
    consoleWrite(this._context, "kernel:resume");
  }

  async snapshot(control) {
    throwIfOperationAborted(control, "kernel snapshot");
    this._assertReady();
    await this._machine.run.python(CAPTURE_HOME_HARNESS);
    const [image, home] = await Promise.all([
      this._machine.history.export(),
      this._machine.run.get("_webHomeSnapshot"),
    ]);
    throwIfOperationAborted(control, "kernel snapshot", { outcomeUnknown: true });
    return encoder.encode(JSON.stringify({ protocol: GUEST_IMAGE_PROTOCOL, version: GUEST_IMAGE_VERSION,
      machineImage: image, home }));
  }

  async restore(payload, context, _manifest, control) {
    throwIfOperationAborted(control, `${context.machineId}: kernel restore`);
    const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    let guestImage;
    try { guestImage = JSON.parse(decoder.decode(bytes)); }
    catch (error) {
      throw new WebMachineError("WEB_MACHINE_IMAGE_FORMAT_INVALID", "kernel guest image is not valid JSON", { cause: error });
    }
    if (guestImage?.protocol !== GUEST_IMAGE_PROTOCOL || guestImage.version !== GUEST_IMAGE_VERSION
      || !guestImage.machineImage || !Array.isArray(guestImage.home)) {
      throw new WebMachineError("WEB_MACHINE_IMAGE_FORMAT_INVALID", "kernel guest image envelope is invalid");
    }
    this._context = context;
    this._machine = await this._openMachineImage(guestImage.machineImage);
    await this._machine.run.set("_webHomeSnapshot", guestImage.home);
    await this._machine.run.python(RESTORE_HOME_HARNESS);
    this._checkpoints = [...(guestImage.machineImage.checkpoints || [])];
    throwIfOperationAborted(control, `${context.machineId}: kernel restore`, { outcomeUnknown: true });
    consoleWrite(context, `kernel:restore:${context.machineId}`);
  }

  async shutdown(control) {
    throwIfOperationAborted(control, "kernel shutdown");
    if (this._machine) await this._machine.close();
    this._machine = null;
    consoleWrite(this._context, "kernel:shutdown");
  }

  async request(message, control) {
    throwIfOperationAborted(control, "kernel request");
    this._assertReady();
    if (message?.type === "run") {
      await this._machine.run.set("_webSource", String(message.code || ""));
      const execution = await this._machine.run.python(RUN_HARNESS);
      const line = execution.output.split("\n").filter(Boolean).at(-1);
      if (!line) return undefined;
      const result = JSON.parse(line);
      return result.value === null ? result.stdout : result.value;
    }
    if (message?.type === "checkpoint") {
      const checkpoint = await this._machine.history.checkpoint();
      const index = this._checkpoints.length;
      this._checkpoints.push(checkpoint);
      return Object.freeze({ index, checkpointRef: checkpoint.checkpointRef,
        changedPages: checkpoint.changedPages, deltaDepth: checkpoint.deltaDepth });
    }
    if (message?.type === "undo") {
      const index = Number.isInteger(message.index) ? message.index : this._checkpoints.length - 1;
      const checkpoint = this._checkpoints[index];
      if (!checkpoint) throw new WebMachineError("WEB_MACHINE_GUEST_STATE", "kernel guest has no checkpoint to restore");
      const restored = await this._machine.history.restore(checkpoint);
      return Object.freeze({ ...restored, index, pagesWritten: checkpoint.changedPages });
    }
    if (message?.type === "historyDepth") {
      return Object.freeze({ depth: this._checkpoints.length,
        live: this._checkpoints.length ? this._checkpoints.length - 1 : null });
    }
    throw new WebMachineError("WEB_MACHINE_GUEST_STATE", `unsupported kernel guest request: ${String(message?.type)}`);
  }

  inspect() {
    return Object.freeze({ engine: "cpython-wasi", ready: !!this._machine,
      workerOwned: true, snapshotScope: this.capabilities.snapshotScope,
      shutdownMode: this.capabilities.shutdownMode });
  }

  _assertReady() {
    if (!this._machine) throw new WebMachineError("WEB_MACHINE_GUEST_STATE", "kernel guest is not booted");
  }
}
