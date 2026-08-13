// verificationTools.js - existing Control과 MCP에 audit, verify, replay를 같은 schema로 연결한다.
import { compareEvidencePacks, evidencePackAttachment, loadEvidencePack, replayEvidencePack } from "./evidencePack.js";
import { VerificationRunner } from "./verificationRunner.js";

const ABSOLUTE_PATH = { type: "string", pattern: "^(?:[A-Za-z]:[\\\\/]|/).+", minLength: 2 };
const REPOSITORY_IDENTITY = Object.freeze({ type: "object", properties: {
  commit: { type: "string", minLength: 1 }, treeSha256: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
  diffSha256: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }, untracked: { type: "boolean" },
}, required: ["commit", "treeSha256", "diffSha256", "untracked"], additionalProperties: false });

export const VERIFICATION_TOOLS = Object.freeze([
  Object.freeze({ name: "eyesAudit", description: "Run a strict repository Experience Contract and publish one canonical Evidence Pack.",
    inputSchema: { type: "object", properties: { contractRoot: ABSOLUTE_PATH, repositoryRoot: ABSOLUTE_PATH,
      outputDir: { type: "string", minLength: 1 }, environmentId: { type: "string", minLength: 1 },
      repository: REPOSITORY_IDENTITY }, required: ["contractRoot", "repositoryRoot", "outputDir", "environmentId", "repository"],
    additionalProperties: false } }),
  Object.freeze({ name: "eyesVerify", description: "Compare two complete exact Evidence Packs without sending a browser effect.",
    inputSchema: { type: "object", properties: { referenceDir: ABSOLUTE_PATH, currentDir: ABSOLUTE_PATH },
      required: ["referenceDir", "currentDir"], additionalProperties: false } }),
  Object.freeze({ name: "eyesReplay", description: "Recompute one Evidence Pack verdict and artifact integrity without a live provider call.",
    inputSchema: { type: "object", properties: { packDir: ABSOLUTE_PATH }, required: ["packDir"], additionalProperties: false } }),
]);

export const VERIFICATION_OFFLINE_TOOLS = Object.freeze(VERIFICATION_TOOLS.filter(
  (tool) => tool.name !== "eyesAudit",
));

export function createVerificationHandlers({ automation, producerVersion }) {
  const runner = automation ? new VerificationRunner({ automation, producerVersion }) : null;
  return Object.freeze({
    "verification.audit": (input, context) => {
      if (!runner) {
        const error = new Error("verification audit requires an enabled AutomationSpace");
        error.code = "CONTROL_OPERATION_UNAVAILABLE";
        error.outcome = "notSent";
        error.retryable = false;
        throw error;
      }
      return runner.audit(input, context);
    },
    "verification.verify": async ({ referenceDir, currentDir }) => {
      const reference = await loadEvidencePack(referenceDir);
      const current = await loadEvidencePack(currentDir);
      const comparison = compareEvidencePacks(reference.pack, current.pack);
      return Object.freeze({ verdict: comparison.terminal, comparison,
        referenceSha256: reference.pack.contentSha256, currentSha256: current.pack.contentSha256,
        packAttachment: evidencePackAttachment(current.pack) });
    },
    "verification.replay": async ({ packDir }) => {
      const loaded = await loadEvidencePack(packDir);
      return Object.freeze({ ...replayEvidencePack(loaded.pack, loaded.artifactBytes),
        packAttachment: evidencePackAttachment(loaded.pack) });
    },
  });
}
