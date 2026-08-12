import { strict as assert } from "node:assert";
import { ReplaySpaceDraft, sealRecording, verifyRecording } from "./replaySpaceDraft.mjs";

let passed = 0;
const check = (name, operation) => {
  operation();
  passed += 1;
  console.log(`  PASS ${name}`);
};
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const artifactRef = "artifact:probe_shot";
const recording = sealRecording({
  recordingId: "recording:probe",
  provider: { providerKind: "fake", operations: ["automation.observe", "automation.act"], capabilities: ["screenshot"] },
  artifacts: { [artifactRef]: { kind: "screenshot", mimeType: "image/png", byteLength: png.byteLength,
    dataBase64: png.toString("base64") } },
  entries: [
    { operation: "automation.observe", input: { expectedRisk: "read" }, terminal: { ok: true, outcome: "observed",
      output: { title: "recorded" } } },
    { operation: "automation.act", input: { actions: [{ kind: "screenshot", expectedRisk: "read" }] },
      inlineArtifacts: [artifactRef], terminal: { ok: true, outcome: "observed", output: { results: [{
        kind: "screenshot", artifactRef, mimeType: "image/png", byteLength: png.byteLength,
        sha256: "ignored-by-draft-output",
      }] } } },
    { operation: "automation.act", input: { actions: [{ kind: "click", expectedRisk: "externalEffect" }] },
      terminal: { ok: false, error: { code: "RECORDED_FAILURE", message: "recorded failure",
        outcome: "outcomeUnknown", retryable: false } } },
  ],
});

console.log("automationComputer ReplaySpace probe");
check("hash chain and artifact digest verify", () => assert.equal(verifyRecording(recording), recording));
check("recorded observation replays without a provider", () => {
  const replay = new ReplaySpaceDraft(recording);
  assert.deepEqual(replay.invoke("automation.observe", { expectedRisk: "read" }), { title: "recorded" });
});
check("screenshot bytes are rehydrated in descriptor order", () => {
  const replay = new ReplaySpaceDraft(recording, { cursor: 1, prefixSha256: recording.entries[0].sha256 });
  assert.equal(replay.invoke("automation.act", { actions: [{ kind: "screenshot", expectedRisk: "read" }] })
    .results[0].dataBase64, png.toString("base64"));
});
check("checkpoint cursor resumes the unfinished suffix deterministically", () => {
  const first = new ReplaySpaceDraft(recording);
  first.invoke("automation.observe", { expectedRisk: "read" });
  const checkpoint = first.checkpoint();
  const resumed = new ReplaySpaceDraft(recording, { cursor: checkpoint.cursor, prefixSha256: checkpoint.prefixSha256 });
  assert.equal(resumed.checkpoint().cursor, 1);
});
check("recorded outcomeUnknown remains non-retryable", () => {
  const replay = new ReplaySpaceDraft(recording, { cursor: 2, prefixSha256: recording.entries[1].sha256 });
  assert.throws(() => replay.invoke("automation.act", { actions: [{ kind: "click", expectedRisk: "externalEffect" }] }),
    (error) => error.code === "RECORDED_FAILURE" && error.outcome === "outcomeUnknown" && error.retryable === false);
});
check("input divergence does not advance the cursor", () => {
  const replay = new ReplaySpaceDraft(recording);
  assert.throws(() => replay.invoke("automation.observe", { expectedRisk: "externalEffect" }),
    (error) => error.code === "REPLAY_DIVERGED");
  assert.equal(replay.checkpoint().cursor, 0);
});
check("tampered entry is rejected", () => {
  const tampered = structuredClone(recording);
  tampered.entries[0].terminal.output.title = "changed";
  assert.throws(() => verifyRecording(tampered), /digest mismatch/);
});
check("missing artifact is rejected", () => {
  const missing = structuredClone(recording);
  delete missing.artifacts[artifactRef];
  assert.throws(() => verifyRecording(missing), /artifact missing/);
});
check("tampered artifact bytes are rejected", () => {
  const tampered = structuredClone(recording);
  tampered.artifacts[artifactRef].dataBase64 = Buffer.from("changed").toString("base64");
  assert.throws(() => verifyRecording(tampered), /artifact invalid/);
});
check("forged resume prefix is rejected", () => {
  assert.throws(() => new ReplaySpaceDraft(recording, { cursor: 1, prefixSha256: "f".repeat(64) }), /cursor is invalid/);
});

console.log(`\n결과: GREEN (${passed}/${passed})`);
