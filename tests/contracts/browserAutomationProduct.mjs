import { createHash, generateKeyPairSync } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BrowserArtifactStore,
  BROWSER_ARTIFACT_MAX_CHUNK_BYTES,
} from "../../scripts/browserControl/browserArtifactStore.js";
import { BrowserScreenshot } from "../../scripts/browserControl/browserScreenshot.js";
import { validateBrowserAutomationAction } from "../../scripts/browserControl/browserAutomationCatalog.js";
import { validateMcpProductConfig } from "../../scripts/mcpProductConfig.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function errorOf(operation) {
  try { await operation(); return null; }
  catch (error) { return error; }
}

export async function assertBrowserAutomationProductContract() {
  const root = await mkdtemp(join(tmpdir(), "pyprocBrowserProductContract-"));
  const engineRoot = join(root, "engine");
  await mkdir(engineRoot);
  await writeFile(join(engineRoot, "python.wasm"), "fixture");
  await writeFile(join(engineRoot, "python314-stdlib.zip"), "fixture");
  await writeFile(join(engineRoot, "engine-build-manifest.json"), "{}");

  const manifest = {
    schemaVersion: 1,
    engine: { root: engineRoot },
    timeoutMs: 120000,
    browser: {
      enabled: true,
      allowedOrigins: ["http://allowed.test"],
      maxRisk: "read",
      actions: ["snapshot", "screenshot", "waitFor"],
      methods: [],
      viewport: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, touch: true },
      artifacts: { maxArtifactBytes: 1024, maxTotalBytes: 4096, maxArtifacts: 4, inlineMaxBytes: 128, ttlMs: 5000 },
    },
  };
  const validated = validateMcpProductConfig(manifest);
  assert(validated.env.PYPROC_MCP_ENGINE_ROOT === engineRoot
    && validated.env.PYPROC_BROWSER_METHODS === ""
    && validated.browserControl.rawMethods.length === 0
    && validated.browserControl.actions.includes("screenshot")
    && validated.env.PYPROC_BROWSER_VIEWPORT.includes('"width":390')
    && validated.browserControl.viewport?.height === 844,
  "제품 manifest가 engine, permission, screenshot, viewport로 투영되지 않았다");
  const roundTrip = validateMcpProductConfig(validated.config);
  assert(roundTrip.config.browser.recording === undefined
    && JSON.stringify(roundTrip.config) === JSON.stringify(validated.config),
  "정규화된 제품 manifest가 같은 validator를 다시 통과하지 못했다");
  const memoryRoot = join(root, "execution-memory");
  const importRoot = join(root, "handoffs");
  const memoryValidated = validateMcpProductConfig({ ...manifest,
    executionMemory: { enabled: true, root: memoryRoot, importRoots: [importRoot],
      secretEnv: ["PYPROC_CONTRACT_SECRET"] },
  }, { baseEnv: { PYPROC_CONTRACT_SECRET: "fixture-secret-value" } });
  assert(memoryValidated.config.executionMemory.root === memoryRoot
    && memoryValidated.config.executionMemory.secretEnv[0] === "PYPROC_CONTRACT_SECRET"
    && !JSON.stringify(memoryValidated.config).includes("fixture-secret-value")
    && memoryValidated.env.PYPROC_EXECUTION_MEMORY_ROOT === memoryRoot
    && JSON.parse(memoryValidated.env.PYPROC_EXECUTION_MEMORY_SECRET_VALUES)[0] === "fixture-secret-value",
  "Execution Memory manifest가 secret 원문과 공개 설정을 분리하지 못했다");
  assert(JSON.stringify(validateMcpProductConfig(memoryValidated.config,
    { baseEnv: { PYPROC_CONTRACT_SECRET: "fixture-secret-value" } }).config)
    === JSON.stringify(memoryValidated.config), "Execution Memory 정규 manifest가 roundtrip하지 않았다");
  const graphValidated = validateMcpProductConfig({ ...manifest,
    executionMemory: { enabled: true, root: memoryRoot, importRoots: [importRoot], secretEnv: [] },
    replayGraph: { enabled: true },
  });
  assert(graphValidated.config.replayGraph.enabled === true
    && graphValidated.env.PYPROC_REPLAY_GRAPH === "1",
  "ReplayGraph manifest가 durable product environment로 투영되지 않았다");
  assert((await errorOf(() => validateMcpProductConfig({ ...manifest,
    replayGraph: { enabled: true } })))?.message.includes("requires executionMemory"),
  "ReplayGraph가 Execution Memory durable root 없이 열렸다");
  const motorValidated = validateMcpProductConfig({ ...manifest,
    browser: { ...manifest.browser, maxRisk: "externalEffect", actions: ["snapshot", "click"],
      externalEffects: "acknowledged", purpose: "Execute one proof-carrying fixture intent" },
    executionMemory: { enabled: true, root: memoryRoot, importRoots: [importRoot],
      secretEnv: ["PYPROC_CONTRACT_SECRET"] }, actuation: { enabled: true },
  }, { baseEnv: { PYPROC_CONTRACT_SECRET: "fixture-secret-value" } });
  assert(motorValidated.config.actuation.enabled === true && motorValidated.env.PYPROC_ACTUATION === "1"
    && JSON.parse(motorValidated.env.PYPROC_ACTUATION_VALUE_BINDINGS).PYPROC_CONTRACT_SECRET
      === "fixture-secret-value",
  "Motor manifest가 durable root와 bounded value provider로 투영되지 않았다");
  assert((await errorOf(() => validateMcpProductConfig({ ...manifest,
    actuation: { enabled: true } })))?.message.includes("requires executionMemory"),
  "Motor가 Execution Memory 없이 열렸다");
  assert((await errorOf(() => validateMcpProductConfig({ ...manifest,
    executionMemory: { enabled: true, root: memoryRoot }, actuation: { enabled: true } })))?.message
    .includes("requires snapshot"), "Motor가 read-only browser permission으로 열렸다");
  assert((await errorOf(() => validateMcpProductConfig({ ...manifest,
    browser: { ...manifest.browser, provider: "frame", maxRisk: "externalEffect",
      actions: ["snapshot", "click"], externalEffects: "acknowledged",
      purpose: "Reject an unattached cooperative Motor" },
    executionMemory: { enabled: true, root: memoryRoot }, actuation: { enabled: true } })))?.message
    .includes("requires appSpace.enabled"), "FrameSpace Motor가 typed AppSpace authority 없이 열렸다");
  const approvalPublicKey = join(root, "approval-public.pem");
  const approvalPair = generateKeyPairSync("ed25519");
  await writeFile(approvalPublicKey, approvalPair.publicKey.export({ type: "spki", format: "pem" }));
  const effectManifest = { ...manifest,
    browser: { ...manifest.browser, maxRisk: "externalEffect", actions: ["snapshot", "click"],
      externalEffects: "acknowledged", purpose: "Commit an exact approved fixture" },
    executionMemory: { enabled: true, root: memoryRoot, importRoots: [importRoot],
      secretEnv: ["PYPROC_CONTRACT_SECRET"] },
    effectTransactions: { enabled: true, approvalAuthorities: [{
      authorityId: "operator:contract", publicKeyFile: approvalPublicKey,
    }] },
  };
  const effectValidated = validateMcpProductConfig(effectManifest,
    { baseEnv: { PYPROC_CONTRACT_SECRET: "fixture-secret-value" } });
  assert(effectValidated.config.effectTransactions.enabled
    && effectValidated.config.effectTransactions.approvalAuthorities[0].publicKeyFile === approvalPublicKey
    && effectValidated.env.PYPROC_EFFECT_TRANSACTIONS === "1"
    && JSON.parse(effectValidated.env.PYPROC_EFFECT_SECRET_BINDINGS).PYPROC_CONTRACT_SECRET === "fixture-secret-value"
    && !JSON.stringify(effectValidated.config).includes("fixture-secret-value"),
  "Rehearse-Commit manifest가 trusted authority와 ephemeral secret provider를 분리하지 못했다");
  assert((await errorOf(() => validateMcpProductConfig({ ...manifest,
    effectTransactions: effectManifest.effectTransactions })))?.message.includes("requires executionMemory"),
  "Rehearse-Commit이 Execution Memory 없이 열렸다");
  const missingSecret = await errorOf(() => validateMcpProductConfig({ ...manifest,
    executionMemory: { enabled: true, root: memoryRoot, secretEnv: ["PYPROC_CONTRACT_SECRET"] },
  }));
  assert(/secret environment variable is unavailable/.test(missingSecret?.message),
    "Execution Memory secretEnv가 없는 값으로 조용히 열렸다");
  const shortSecret = await errorOf(() => validateMcpProductConfig({ ...manifest,
    executionMemory: { enabled: true, root: memoryRoot, secretEnv: ["PYPROC_CONTRACT_SECRET"] },
  }, { baseEnv: { PYPROC_CONTRACT_SECRET: "short" } }));
  assert(/too short for binary redaction/.test(shortSecret?.message),
    "짧은 secret fixture가 binary false-positive 경계를 우회했다");
  const unknownKey = await errorOf(() => validateMcpProductConfig({ ...manifest, surprise: true }));
  assert(/does not accept surprise/.test(unknownKey?.message), "제품 manifest unknown key가 fail-closed가 아니다");
  const unknownBrowserKey = await errorOf(() => validateMcpProductConfig({
    ...manifest, browser: { ...manifest.browser, surprise: true },
  }));
  assert(/browser does not accept surprise/.test(unknownBrowserKey?.message),
    "제품 browser manifest unknown key가 fail-closed가 아니다");
  const invalidViewport = await errorOf(() => validateMcpProductConfig({
    ...manifest, browser: { ...manifest.browser, viewport: { width: 0, height: 844 } },
  }));
  assert(/browser\.viewport\.width must be an integer/.test(invalidViewport?.message),
    "제품 browser viewport 범위가 fail-closed가 아니다");
  const unknownViewportKey = await errorOf(() => validateMcpProductConfig({
    ...manifest, browser: { ...manifest.browser, viewport: { width: 390, height: 844, colorDepth: 24 } },
  }));
  assert(/browser\.viewport does not accept colorDepth/.test(unknownViewportKey?.message),
    "제품 browser viewport unknown key가 fail-closed가 아니다");
  const remoteEngine = await errorOf(() => validateMcpProductConfig({
    schemaVersion: 1, engine: { remote: "https://engine.example.test/cpython-wasi-v1" },
    browser: { enabled: false },
  }));
  assert(/engine does not accept remote/.test(remoteEngine?.message),
    "제품 engine이 검증 전 remote artifact를 허용했다");
  const relativeEngine = await errorOf(() => validateMcpProductConfig({
    ...manifest, engine: { root: "vendor/cpython-wasi" },
  }));
  assert(/must be an absolute directory/.test(relativeEngine?.message), "상대 engine root가 허용됐다");
  const wildcardOrigin = await errorOf(() => validateMcpProductConfig({
    ...manifest, browser: { ...manifest.browser, allowedOrigins: ["http://*.test"] },
  }));
  assert(/exact HTTP\(S\) origin/.test(wildcardOrigin?.message), "wildcard browser origin이 허용됐다");
  const unacknowledgedEffect = await errorOf(() => validateMcpProductConfig({
    ...manifest,
    browser: { ...manifest.browser, maxRisk: "externalEffect", actions: ["screenshot", "click"] },
  }));
  assert(/externalEffect requires/.test(unacknowledgedEffect?.message), "제품 manifest가 external effect 이중 승인을 건너뛴다");

  let now = 1000;
  let sequence = 0;
  const artifactRoot = join(root, "artifacts");
  const store = new BrowserArtifactStore({
    root: artifactRoot,
    maxArtifactBytes: 32,
    maxTotalBytes: 40,
    maxArtifacts: 2,
    inlineMaxBytes: 8,
    ttlMs: 100,
    idFactory: () => `opaque-${++sequence}`,
    now: () => now,
  });
  const firstBytes = Buffer.from("0123456789abcdef");
  const first = await store.put(firstBytes, { kind: "fixture", mimeType: "application/octet-stream" }, { inline: true });
  assert(first.artifactRef === "artifact:opaque-1" && !first.dataBase64
    && first.sha256 === createHash("sha256").update(firstBytes).digest("hex")
    && !JSON.stringify(first).includes(artifactRoot),
  "artifact descriptor가 opaque ref, inline limit, digest 경계를 보존하지 않았다");
  const part1 = await store.read(first.artifactRef, { maxBytes: 5 });
  const part2 = await store.read(first.artifactRef, { offset: part1.nextOffset, maxBytes: 32 });
  assert(Buffer.concat([Buffer.from(part1.dataBase64, "base64"), Buffer.from(part2.dataBase64, "base64")]).equals(firstBytes)
    && part1.eof === false && part2.eof === true
    && store.inspect().maxChunkBytes === BROWSER_ARTIFACT_MAX_CHUNK_BYTES,
  "artifact chunk offset와 EOF 계약으로 원본이 재조립되지 않았다");
  const quota = await errorOf(() => store.put(Buffer.alloc(25, 1)));
  assert(quota?.code === "BROWSER_AUTOMATION_ARTIFACT_QUOTA", "artifact total quota가 초과 쓰기를 거부하지 않았다");
  now += 101;
  assert(await store.reap() === 1 && existsSync(artifactRoot),
    "artifact TTL reap가 만료 레코드를 회수하지 않았다");
  const stale = await errorOf(() => store.read(first.artifactRef));
  assert(stale?.code === "BROWSER_AUTOMATION_ARTIFACT_NOT_FOUND", "만료 artifact ref가 stale 처리되지 않았다");

  const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const commands = [];
  const screenshot = new BrowserScreenshot({
    artifactStore: store,
    command: async (sessionRef, method, params) => {
      commands.push({ method, params });
      if (method === "Page.getLayoutMetrics") {
        return { result: { cssVisualViewport: { clientWidth: 800, clientHeight: 600 }, contentSize: { width: 800, height: 1400 } } };
      }
      return { result: { data: pngBytes.toString("base64") } };
    },
  });
  const captured = await screenshot.capture({}, { format: "png", fullPage: true, inline: true }, [], null);
  assert(captured.format === "png" && captured.fullPage === true && captured.cssHeight === 1400
    && Buffer.from(captured.dataBase64, "base64").equals(pngBytes)
    && commands[1].params.clip.height === 1400 && commands[1].params.clip.scale === 1
    && commands[1].params.captureBeyondViewport === true,
  "full-page screenshot이 layout guard와 artifact store를 통과하지 않았다");
  const omittedScaleAction = { kind: "screenshot", format: "png",
    clip: { x: 0, y: 0, width: 100, height: 100 }, expectedRisk: "read" };
  validateBrowserAutomationAction(omittedScaleAction);
  const omittedScale = await screenshot.capture({}, omittedScaleAction, [], null);
  const omittedScaleCommand = commands.filter((command) => command.method === "Page.captureScreenshot").at(-1);
  assert(omittedScale.cssWidth === 100 && omittedScale.cssHeight === 100
    && omittedScaleCommand.params.clip.scale === 1 && omittedScaleCommand.params.clip.width === 100,
  "optional screenshot clip scale이 CDP 전송 전에 1로 정규화되지 않았다");
  const directZeroScale = await errorOf(() => screenshot.capture({}, {
    kind: "screenshot", format: "png", clip: { x: 0, y: 0, width: 100, height: 100, scale: 0 },
  }, [], null));
  assert(directZeroScale?.code === "BROWSER_AUTOMATION_SCREENSHOT_BOUNDS"
    && directZeroScale.details?.reason === "scale"
    && directZeroScale.details?.measured.scale === 0
    && directZeroScale.details?.limits.maxCssDimension === 32768,
  "screenshot capture 경계가 0 scale과 측정 detail을 직접 호출에서 거부하지 않았다");
  let guardedCaptureCalls = 0;
  const guarded = new BrowserScreenshot({
    artifactStore: store,
    command: async (sessionRef, method) => {
      if (method === "Page.getLayoutMetrics") {
        return { result: {
          cssVisualViewport: { clientWidth: 800, clientHeight: 600 },
          cssContentSize: { width: 800, height: 32769 },
          contentSize: { width: 100, height: 100 },
        } };
      }
      guardedCaptureCalls += 1;
      throw new Error("raw provider screenshot error");
    },
  });
  const contentBounds = await errorOf(() => guarded.capture({}, {
    kind: "screenshot", format: "png", fullPage: true,
  }, [], null));
  assert(contentBounds?.code === "BROWSER_AUTOMATION_SCREENSHOT_BOUNDS"
    && contentBounds.outcome === "notSent" && contentBounds.retryable === false
    && contentBounds.details?.reason === "dimension"
    && contentBounds.details?.source === "content"
    && contentBounds.details?.measured.cssWidth === 800
    && contentBounds.details?.measured.cssHeight === 32769
    && contentBounds.details?.limits.maxCssDimension === 32768
    && contentBounds.details?.limits.maxScaledCssPixels === 67108864
    && contentBounds.details?.recovery.viewportScrollMayTriggerEffects === true
    && guardedCaptureCalls === 0,
  "최신 CSS content bounds 초과가 capture 전에 안정 code와 측정 detail로 닫히지 않았다");
  const areaGuarded = new BrowserScreenshot({
    artifactStore: store,
    command: async (sessionRef, method) => {
      if (method === "Page.getLayoutMetrics") {
        return { result: { cssVisualViewport: { clientWidth: 800, clientHeight: 600 },
          cssContentSize: { width: 32768, height: 2049 } } };
      }
      throw new Error("area guard dispatched capture");
    },
  });
  const areaBounds = await errorOf(() => areaGuarded.capture({}, {
    kind: "screenshot", format: "png", fullPage: true,
  }, [], null));
  assert(areaBounds?.code === "BROWSER_AUTOMATION_SCREENSHOT_BOUNDS"
    && areaBounds.details?.reason === "area"
    && areaBounds.details?.measured.scaledCssPixels === 67141632,
  "scaled CSS area 초과가 capture 전에 측정값으로 거부되지 않았다");
  const invalidQuality = await errorOf(() => validateBrowserAutomationAction({
    kind: "screenshot", format: "png", quality: 80, expectedRisk: "read",
  }));
  assert(/only valid for JPEG or WebP/.test(invalidQuality?.message), "PNG quality 조합이 action validation을 우회했다");
  const invalidClip = await errorOf(() => validateBrowserAutomationAction({
    kind: "screenshot", fullPage: true, clip: { x: 0, y: 0, width: 1, height: 1 }, expectedRisk: "read",
  }));
  assert(/fullPage or clip/.test(invalidClip?.message), "full-page와 clip 동시 지정이 허용됐다");
  const invalidScale = await errorOf(() => validateBrowserAutomationAction({
    kind: "screenshot", clip: { x: 0, y: 0, width: 1, height: 1, scale: 0 }, expectedRisk: "read",
  }));
  assert(invalidScale?.code === "BROWSER_AUTOMATION_SCREENSHOT_BOUNDS"
    && invalidScale.details?.reason === "scale", "0 screenshot clip scale이 action bounds 계약을 우회했다");
  const invalidExtent = await errorOf(() => validateBrowserAutomationAction({
    kind: "screenshot", clip: { x: 0, y: 32768, width: 1, height: 1 }, expectedRisk: "read",
  }));
  assert(invalidExtent?.code === "BROWSER_AUTOMATION_SCREENSHOT_BOUNDS"
    && invalidExtent.details?.reason === "extent"
    && invalidExtent.details?.measured.y === 32768
    && invalidExtent.details?.measured.cssHeight === 1,
  "절대 clip extent 초과가 공개 bounds code와 측정 detail로 거부되지 않았다");

  const capturedDelete = await store.delete(captured.artifactRef);
  const omittedDelete = await store.delete(omittedScale.artifactRef);
  assert(capturedDelete.deleted === true && omittedDelete.deleted === true,
    "artifact 명시 삭제가 파일을 회수하지 않았다");

  const soakRoot = join(root, "artifactSoak");
  let soakId = 0;
  const soak = new BrowserArtifactStore({
    root: soakRoot,
    maxArtifactBytes: 1024,
    maxTotalBytes: 8192,
    maxArtifacts: 8,
    inlineMaxBytes: 64,
    ttlMs: 10000,
    idFactory: () => `soak-${++soakId}`,
  });
  for (let index = 0; index < 128; index += 1) {
    const bytes = Buffer.from(`artifact-soak-${index}`);
    const descriptor = await soak.put(bytes);
    const read = await soak.read(descriptor.artifactRef, { maxBytes: 7 });
    assert(Buffer.from(read.dataBase64, "base64").equals(bytes.subarray(0, 7)),
      `artifact soak chunk mismatch at ${index}`);
    assert((await soak.delete(descriptor.artifactRef)).deleted === true,
      `artifact soak delete mismatch at ${index}`);
  }
  assert(soak.inspect().artifacts === 0 && soak.inspect().totalBytes === 0,
    "artifact 반복 생성과 삭제 뒤 quota 원장이 0으로 수렴하지 않았다");
  await soak.close();
  assert(!existsSync(soakRoot), "artifact soak 종료가 디렉터리를 정리하지 않았다");
  await store.close();
  assert(!existsSync(artifactRoot), "artifact store 종료가 디렉터리를 정리하지 않았다");
}
