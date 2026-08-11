import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebMachineHost } from "../../src/machine/host/webMachineHost.js";
import { resolveRequiredDevice } from "../../src/machine/contracts/deviceRequirement.js";
import { readDevToolsEndpoint } from "../../scripts/browserControl/browserControlBroker.mjs";
import {
  BrowserControlPort,
  BROWSER_CONTROL_ERROR_CODES,
  BROWSER_CONTROL_PROTOCOL_VERSION,
} from "../../scripts/browserControl/browserControlPort.js";
import { BrowserControlPolicy } from "../../scripts/browserControl/browserControlPolicy.js";
import {
  assertBrowserCompatibility,
  inspectBrowserCompatibility,
} from "../../scripts/browserControl/browserCompatibility.js";
import { headlessArgs } from "../../scripts/browserControl/browserLauncher.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function errorOf(operation) {
  try { await operation(); return null; }
  catch (error) { return error; }
}

class FakeTransport {
  constructor() {
    this.targets = [
      { id: "allowed", type: "page", url: "http://allowed.test/app", title: "allowed" },
      { id: "denied", type: "page", url: "http://denied.test/secret", title: "secret" },
    ];
    this.sessions = new Map();
    this.listeners = new Map();
    this.commands = [];
    this.activations = [];
    this.failure = null;
    this.afterSend = null;
    this.describeOverride = null;
    this.describeCalls = 0;
    this.closed = false;
  }

  async listTargets() { return this.targets.map((target) => ({ ...target })); }

  async closeTarget(targetId) {
    this.targets = this.targets.filter((target) => target.id !== targetId);
    return { success: true };
  }

  async activateTarget(targetId) {
    this.activations.push(targetId);
    return { success: true };
  }

  async attach(targetId) {
    const session = Object.freeze({ id: `raw:${targetId}`, targetId });
    this.sessions.set(session.id, session);
    return session;
  }

  async describe(session) {
    this.describeCalls += 1;
    if (this.describeOverride) return { ...this.describeOverride, id: session.targetId };
    const target = this.targets.find((entry) => entry.id === session.targetId);
    if (!target) throw new Error("target unavailable");
    return { ...target };
  }

  async send(session, command, { signal } = {}) {
    if (!this.sessions.has(session.id)) throw new Error("raw session detached");
    this.commands.push({ session, command });
    if (this.failure === "unknown") {
      const error = new Error("transport died after send");
      error.outcomeUnknown = true;
      throw error;
    }
    if (this.failure === "timeout") {
      const error = new Error("transport timed out after send");
      error.outcomeUnknown = true;
      error.timedOut = true;
      throw error;
    }
    if (this.failure === "unsupported") {
      const error = new Error("method not found");
      error.protocolRejected = true;
      error.protocolCode = -32601;
      throw error;
    }
    if (this.failure === "context") throw new Error("execution context was destroyed");
    if (this.failure === "cancelAfterSend") {
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("cancelled after send");
          error.cancelled = true;
          error.outcomeUnknown = true;
          reject(error);
        }, { once: true });
        this.afterSend?.();
      });
    }
    return Object.freeze({ ok: true, method: command.method });
  }

  subscribe(session, listener) {
    this.listeners.set(session.id, listener);
    return () => this.listeners.delete(session.id);
  }

  async detach(session) {
    this.sessions.delete(session.id);
    this.listeners.delete(session.id);
  }

  async close() {
    this.closed = true;
    this.sessions.clear();
    this.listeners.clear();
  }

  emit(targetId, method, params = {}) {
    this.listeners.get(`raw:${targetId}`)?.({ method, params });
  }
}

function browserGuestFactory() {
  const requirement = Object.freeze({
    name: "browser",
    kind: "browser-control",
    mode: "command",
    methods: ["listTargets", "attach", "send", "subscribe", "detach", "close"],
  });
  let browser = null;
  return {
    capabilities: {
      adapterVersion: "browser-contract-1",
      snapshotScope: "none",
      pauseMode: "cooperative",
      shutdownMode: "terminate",
      requiredDevices: [requirement],
    },
    async boot(context) { browser = resolveRequiredDevice(context.devices, requirement, "browser guest"); },
    async pause() {},
    async resume() {},
    async snapshot() { return new Uint8Array(); },
    async restore() {},
    async shutdown() { browser = null; },
    async request() { return browser?.protocolVersion || null; },
    inspect() { return { connected: !!browser }; },
  };
}

export async function assertBrowserControlContract() {
  const defaultBrowserArgs = headlessArgs("contract-profile");
  assert(defaultBrowserArgs.includes("--disable-extensions"), "공용 browser harness 기본 extension 차단이 열렸다");
  assert(!defaultBrowserArgs.some((arg) => arg.startsWith("--remote-debugging")),
    "공용 browser harness 기본값에 remote debugging 권한이 들어갔다");
  const extensionArgs = headlessArgs("contract-profile", { enableExtensions: true });
  assert(!extensionArgs.includes("--disable-extensions"), "명시적 extension probe opt-in이 닫혀 있다");

  const profileDir = await mkdtemp(join(tmpdir(), "pyprocBrowserControlContract-"));
  try {
    const unavailable = await errorOf(() => readDevToolsEndpoint(profileDir, { timeoutMs: 5 }));
    assert(unavailable?.code === BROWSER_CONTROL_ERROR_CODES.brokerUnavailable,
      "remote debugging authority가 없는 profile이 fail-closed가 아니다");
  } finally {
    await rm(profileDir, { recursive: true, force: true });
  }

  let rejected = false;
  try { new BrowserControlPolicy({ targetOrigins: ["http://allowed.test"], methods: ["Unknown.doThing"] }); }
  catch (error) { rejected = /unclassified/.test(error.message); }
  assert(rejected, "분류 없는 CDP method를 policy가 거부하지 않았다");

  rejected = false;
  try { new BrowserControlPolicy({ targetOrigins: ["http://allowed.test"], methods: ["toString"] }); }
  catch (error) { rejected = /unclassified/.test(error.message); }
  assert(rejected, "Object prototype 이름이 CDP method allowlist를 우회했다");

  rejected = false;
  try { new BrowserControlPolicy({ targetOrigins: ["http://allowed.test"], methods: [], maxRisk: "toString" }); }
  catch (error) { rejected = /unsupported/.test(error.message); }
  assert(rejected, "Object prototype 이름이 maxRisk allowlist를 우회했다");

  rejected = false;
  try { new BrowserControlPolicy({ targetOrigins: ["http://allowed.test"], methods: ["Runtime.evaluate"], maxRisk: "read" }); }
  catch (error) { rejected = /exceeds/.test(error.message); }
  assert(rejected, "호출자가 Runtime.evaluate 위험도를 read로 낮췄다");

  rejected = false;
  try { new BrowserControlPolicy({ targetOrigins: ["http://allowed.test/path"], methods: [] }); }
  catch (error) { rejected = /origin must be exact/.test(error.message); }
  assert(rejected, "경로가 포함된 origin permission을 허용했다");

  rejected = false;
  try { new BrowserControlPolicy({ targetOrigins: ["file:///tmp"], methods: [] }); }
  catch (error) { rejected = /http or https/.test(error.message); }
  assert(rejected, "HTTP(S)가 아닌 target origin을 허용했다");

  rejected = false;
  try { new BrowserControlPolicy({ targetOrigins: [], methods: [], downloadRoot: "relative-downloads" }); }
  catch (error) { rejected = /download root must be absolute/.test(error.message); }
  assert(rejected, "상대 download root가 policy 구성 시점에 거부되지 않았다");

  const compatible = assertBrowserCompatibility({
    protocolVersion: "1.3", product: "Chrome/140.0.0.0", jsVersion: "14.0",
  });
  assert(compatible.supported && compatible.browserMajor === 140 && !Object.hasOwn(compatible, "userAgent"),
    "browser compatibility 진단이 지원 버전 또는 최소 정보 계약을 보존하지 않았다");
  const incompatible = inspectBrowserCompatibility({ protocolVersion: "2.0", product: "Firefox/140" });
  const incompatibleError = await errorOf(() => assertBrowserCompatibility({
    protocolVersion: "2.0", product: "Firefox/140",
  }));
  assert(!incompatible.supported && incompatible.reasons.length === 2
    && incompatibleError?.code === BROWSER_CONTROL_ERROR_CODES.commandUnsupported
    && incompatibleError.outcome === "notSent",
  "지원 밖 browser/CDP 조합이 broker 시작 전에 fail-closed가 아니다");

  const guardedPolicy = new BrowserControlPolicy({
    targetOrigins: ["http://allowed.test"],
    methods: [
      "Page.navigate", "Network.getCookies", "Network.setCookie", "Network.deleteCookies",
      "DOMStorage.getDOMStorageItems", "DOMStorage.setDOMStorageItem",
      "Storage.clearDataForOrigin", "DOM.setFileInputFiles",
    ],
    fileRoots: [process.cwd()],
    maxRisk: "externalEffect",
  });
  const guardedTarget = { id: "allowed", type: "page", url: "http://allowed.test/app" };
  assert(!guardedPolicy.allowsTarget({ id: "blob", type: "page", url: "blob:http://allowed.test/value" })
    && !guardedPolicy.allowsTarget({ id: "credentials", type: "page", url: "http://user:secret@allowed.test/app" }),
  "HTTP(S) exact target 검사가 blob 또는 embedded credentials를 허용했다");
  for (const [method, params] of [
    ["Page.navigate", { url: "http://denied.test/secret" }],
    ["Network.getCookies", {}],
    ["Network.setCookie", { name: "token", value: "secret", domain: "allowed.test" }],
    ["Network.deleteCookies", { name: "token", domain: "allowed.test" }],
    ["DOMStorage.getDOMStorageItems", { storageId: { securityOrigin: "http://denied.test", isLocalStorage: true } }],
    ["DOMStorage.setDOMStorageItem", { storageId: { securityOrigin: "http://allowed.test" }, key: "x", value: "y" }],
    ["Storage.clearDataForOrigin", { origin: "http://denied.test" }],
    ["DOM.setFileInputFiles", { files: [process.execPath], nodeId: 1 }],
  ]) {
    const deniedParams = await errorOf(async () => guardedPolicy.authorizeCommand(guardedTarget, method, params));
    assert(deniedParams?.code === BROWSER_CONTROL_ERROR_CODES.permissionDenied
      && !deniedParams.message.includes("denied.test"), `${method} parameter guard가 fail-closed가 아니다`);
  }
  assert(guardedPolicy.authorizeCommand(guardedTarget, "Page.navigate", { url: "http://allowed.test/next" }) === "externalEffect",
    "허용 origin navigation을 parameter guard가 막았다");
  assert(guardedPolicy.authorizeCommand(guardedTarget, "DOM.setFileInputFiles", {
    files: [join(process.cwd(), "LICENSE")], nodeId: 1,
  }) === "externalEffect", "허용 root 안 upload file을 parameter guard가 막았다");
  assert(guardedPolicy.authorizeCommand(guardedTarget, "DOMStorage.setDOMStorageItem", {
    storageId: { securityOrigin: "http://allowed.test", isLocalStorage: true }, key: "mode", value: "ready",
  }) === "externalEffect", "허용 origin storage destination을 parameter guard가 막았다");

  const blankTransport = new FakeTransport();
  const blankPort = new BrowserControlPort({
    transport: blankTransport,
    policy: new BrowserControlPolicy({ targetOrigins: ["http://allowed.test"], methods: ["DOM.getDocument"] }),
    brokerId: "blank-broker",
    idFactory: (() => { let value = 0; return () => `blank-${++value}`; })(),
  });
  const [blankTarget] = await blankPort.listTargets();
  blankTransport.targets[0].url = "";
  blankTransport.describeOverride = { type: "page", url: "http://denied.test/after-attach", title: "denied" };
  const deniedAfterAttach = await errorOf(() => blankPort.attach(blankTarget.targetRef));
  assert(deniedAfterAttach?.code === BROWSER_CONTROL_ERROR_CODES.permissionDenied,
    "blank browser-level URL 뒤 session-level origin 재검사가 실패했다");
  assert(blankTransport.sessions.size === 0, "post-attach origin 거부 뒤 raw debugger session이 남았다");
  await blankPort.close();

  const transport = new FakeTransport();
  let id = 0;
  const port = new BrowserControlPort({
    transport,
    policy: new BrowserControlPolicy({
      targetOrigins: ["http://allowed.test"],
      methods: ["DOM.getDocument", "DOM.setAttributeValue", "Runtime.evaluate", "Page.handleJavaScriptDialog"],
      events: ["Network.requestWillBeSent"],
      maxRisk: "externalEffect",
    }),
    brokerId: "broker-a",
    brokerEpoch: 7,
    idFactory: () => String(++id),
  });

  const targets = await port.listTargets();
  assert(targets.length === 1 && targets[0].url === "http://allowed.test/app", "target allowlist가 어긋났다");
  assert(!JSON.stringify(targets).includes("secret") && targets[0].targetRef !== "allowed", "denied metadata 또는 raw target ID가 노출됐다");

  const session = await port.attach(targets[0].targetRef);
  assert(session.protocolVersion === BROWSER_CONTROL_PROTOCOL_VERSION, "session protocol version이 없다");
  assert(session.brokerId === "broker-a" && session.brokerEpoch === 7 && session.sessionId.startsWith("session:"), "session fencing이 어긋났다");

  const allowedCapture = await port.beginPopupCapture(session);
  transport.targets.push({
    id: "popup-allowed", openerId: "allowed", type: "page", url: "http://allowed.test/popup", title: "popup",
  });
  const allowedPopup = await port.finishPopupCapture(session, allowedCapture, { timeoutMs: 500 });
  assert(allowedPopup.targetRef !== "popup-allowed" && allowedPopup.url === "http://allowed.test/popup"
    && !JSON.stringify(allowedPopup).includes("popup-allowed"),
  "popup capture가 raw target ID를 숨기지 못했다");
  await transport.closeTarget("popup-allowed");

  const deniedCapture = await port.beginPopupCapture(session);
  transport.targets.push({
    id: "popup-denied", openerId: "allowed", type: "page", url: "http://denied.test/popup", title: "secret",
  });
  const deniedPopup = await errorOf(() => port.finishPopupCapture(session, deniedCapture, { timeoutMs: 500 }));
  assert(deniedPopup?.code === BROWSER_CONTROL_ERROR_CODES.permissionDenied && deniedPopup.outcome === "applied"
    && !transport.targets.some((target) => target.id === "popup-denied")
    && transport.activations.at(-1) === "allowed"
    && !deniedPopup.message.includes("denied.test"),
  "권한 밖 popup을 닫고 opener를 복원한 applied 실패로 보존하지 못했다");

  const read = await port.send(session, { method: "DOM.getDocument" });
  const mutate = await port.send(session, { method: "DOM.setAttributeValue" });
  const external = await port.send(session, { method: "Runtime.evaluate" });
  assert(read.state === "observed" && read.risk === "read", "read outcome이 observed가 아니다");
  assert(mutate.state === "applied" && mutate.risk === "mutate", "mutate outcome이 applied가 아니다");
  assert(external.state === "applied" && external.risk === "externalEffect", "external effect 분류가 어긋났다");
  assert(new Set([read.requestId, mutate.requestId, external.requestId]).size === 3, "request ID가 단조 고유하지 않다");
  const describedBeforeModal = transport.describeCalls;
  const modal = await port.send(session, { method: "Page.handleJavaScriptDialog", params: { accept: false } });
  assert(modal.state === "applied" && transport.describeCalls === describedBeforeModal,
    "modal unblock command가 verified target을 쓰지 않고 막힌 origin 재조회를 시도했다");

  const deniedMethod = await errorOf(() => port.send(session, { method: "Page.navigate" }));
  assert(deniedMethod?.code === BROWSER_CONTROL_ERROR_CODES.permissionDenied && deniedMethod.outcome === "notSent", "method permission 거부가 notSent가 아니다");
  const riskMismatch = await errorOf(() => port.send(session, { method: "Runtime.evaluate", expectedRisk: "read" }));
  assert(riskMismatch?.code === BROWSER_CONTROL_ERROR_CODES.permissionDenied && riskMismatch.outcome === "notSent", "명령 위험도 오인을 전송 전에 거부하지 않았다");

  transport.targets[0].url = "http://denied.test/after-attach";
  const originSwap = await errorOf(() => port.send(session, { method: "DOM.getDocument" }));
  assert(originSwap?.code === BROWSER_CONTROL_ERROR_CODES.permissionDenied, "attach 뒤 origin 변경을 거부하지 않았다");
  assert(!originSwap.message.includes("denied.test"), "permission error에 denied target URL이 노출됐다");
  assert((await port.listTargets()).length === 0, "권한 밖으로 이동한 target metadata를 열거했다");
  transport.targets[0].url = "http://allowed.test/app";
  await port.send(session, { method: "DOM.getDocument" });

  const events = [];
  port.subscribe(session, (event) => events.push(event));
  transport.emit("allowed", "Network.requestWillBeSent", { request: { url: "http://allowed.test/data" } });
  transport.emit("allowed", "Runtime.consoleAPICalled", { secret: true });
  transport.emit("allowed", "Runtime.executionContextsCleared", {});
  assert(events.length === 2 && events[0].method === "Network.requestWillBeSent" && events[1].method === "Transport.contextReplaced", "event allowlist가 어긋났다");
  assert(events[0].sequence + 1 === events[1].sequence && events[1].params.contextEpoch === 1, "event sequence 또는 context epoch가 어긋났다");
  const modalAfterContext = await errorOf(() => port.send(session, {
    method: "Page.handleJavaScriptDialog", params: { accept: false },
  }));
  assert(modalAfterContext?.code === BROWSER_CONTROL_ERROR_CODES.permissionDenied && modalAfterContext.outcome === "notSent",
    "context 교체 뒤 modal unblock이 stale target 권한을 재사용했다");
  transport.emit("allowed", "Network.requestWillBeSent", { request: { url: "http://denied.test/after-navigation" } });
  assert(events.length === 2, "context 교체 뒤 재검증 전 event가 전달됐다");

  const beforeCancel = transport.commands.length;
  const preCancelled = new AbortController();
  preCancelled.abort();
  const cancelledBeforeSend = await errorOf(() => port.send(session, { method: "Runtime.evaluate" }, { signal: preCancelled.signal }));
  assert(cancelledBeforeSend?.code === BROWSER_CONTROL_ERROR_CODES.commandCancelled && cancelledBeforeSend.outcome === "notSent", "pre-send cancellation이 notSent가 아니다");
  assert(transport.commands.length === beforeCancel, "취소된 명령이 transport로 전송됐다");

  transport.failure = "cancelAfterSend";
  const inFlight = new AbortController();
  transport.afterSend = () => inFlight.abort();
  const cancelledAfterSend = await errorOf(() => port.send(session, { method: "Runtime.evaluate" }, { signal: inFlight.signal }));
  assert(cancelledAfterSend?.code === BROWSER_CONTROL_ERROR_CODES.commandCancelled && cancelledAfterSend.outcome === "outcomeUnknown", "post-send cancellation이 outcomeUnknown이 아니다");

  transport.failure = "timeout";
  const timedOut = await errorOf(() => port.send(session, { method: "Runtime.evaluate" }));
  assert(timedOut?.code === BROWSER_CONTROL_ERROR_CODES.commandTimeout && timedOut.outcome === "outcomeUnknown" && !timedOut.retryable, "timeout 의미가 어긋났다");

  transport.failure = "unknown";
  const uncertain = await errorOf(() => port.send(session, { method: "Runtime.evaluate" }));
  assert(uncertain?.code === BROWSER_CONTROL_ERROR_CODES.outcomeUnknown && uncertain.outcome === "outcomeUnknown" && !uncertain.retryable, "transport loss가 outcomeUnknown이 아니다");

  transport.failure = "unsupported";
  const unsupported = await errorOf(() => port.send(session, { method: "Runtime.evaluate" }));
  assert(unsupported?.code === BROWSER_CONTROL_ERROR_CODES.commandUnsupported && unsupported.outcome === "rejected", "unsupported command 오류가 분리되지 않았다");

  transport.failure = "context";
  const context = await errorOf(() => port.send(session, { method: "Runtime.evaluate" }));
  assert(context?.code === BROWSER_CONTROL_ERROR_CODES.contextReplaced && context.retryable, "context replacement 오류가 분리되지 않았다");
  transport.failure = null;

  const stale = await errorOf(() => port.send({ ...session, brokerEpoch: 6 }, { method: "DOM.getDocument" }));
  assert(stale?.code === BROWSER_CONTROL_ERROR_CODES.staleBroker, "stale broker epoch가 거부되지 않았다");
  const forged = await errorOf(() => port.send({ ...session, targetRef: "target:forged" }, { method: "DOM.getDocument" }));
  assert(forged?.code === BROWSER_CONTROL_ERROR_CODES.sessionDetached, "session targetRef 변조가 거부되지 않았다");

  const host = new WebMachineHost({ devices: { browser: port }, idFactory: () => `machine-${++id}` });
  host.registerAdapter("browser-guest", browserGuestFactory);
  const machine = host.createMachine({ machineId: "allowed-machine", adapterId: "browser-guest", permissions: { devices: ["browser"] } });
  await machine.boot();
  assert(await machine.request({ type: "version" }) === BROWSER_CONTROL_PROTOCOL_VERSION, "BrowserControlPort가 Machine device로 주입되지 않았다");
  const deniedMachine = host.createMachine({ machineId: "denied-machine", adapterId: "browser-guest", permissions: { devices: [] } });
  const deniedBoot = await errorOf(() => deniedMachine.boot());
  assert(deniedBoot?.code === "WEB_MACHINE_DEVICE_PERMISSION_DENIED", "Machine device permission이 browser port를 막지 못했다");
  await machine.shutdown();

  transport.emit("allowed", "Transport.detached", { reason: "target_closed" });
  const detached = await errorOf(() => port.send(session, { method: "DOM.getDocument" }));
  assert(detached?.code === BROWSER_CONTROL_ERROR_CODES.sessionDetached, "target close 뒤 session이 detached가 아니다");
  assert(events.at(-1)?.method === "Transport.detached" && events.at(-1)?.params.reason === "target_closed", "detach reason이 보존되지 않았다");

  await port.close();
  const closed = await errorOf(() => port.listTargets());
  assert(closed?.code === BROWSER_CONTROL_ERROR_CODES.brokerUnavailable && transport.closed, "broker close가 unavailable로 수렴하지 않았다");
  return true;
}
