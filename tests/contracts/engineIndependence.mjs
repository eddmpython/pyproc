import { access, readFile } from "node:fs/promises";
import { assertCouplingInventory, packedCouplings, sourceCouplings }
  from "../../scripts/engineIndependence/scanEngineIndependence.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function assertEngineIndependenceInventory() {
  const inventory = await assertCouplingInventory();
  assert(inventory.files === 0 && inventory.verifiedAbsent === true && (await sourceCouplings()).length === 0,
    "Initiative 10 deleted source coupling is not exactly absent");
  const evidence = JSON.parse(await readFile(
    new URL("../../scripts/engineIndependence/evidenceRegister.json", import.meta.url), "utf8"));
  const classifications = new Set(evidence.evidence.map((entry) => entry.classification));
  assert(evidence.schemaVersion === 1
    && evidence.recordPolicy.includes("retired research probes")
    && evidence.recordPolicy.includes("currentProductGates")
    && evidence.currentProductGates.length >= 5
    && ["PROVEN_LOCAL", "UPSTREAM_CONTRACT", "ENGINEERING_INFERENCE"].every((name) => classifications.has(name))
    && evidence.evidence.every((entry) => entry.evidenceId && entry.claim || entry.result),
  "engine independence evidence register is incomplete");
  const gatePaths = evidence.currentProductGates.map((gate) => gate.path);
  assert(new Set(gatePaths).size === gatePaths.length
    && evidence.currentProductGates.every((gate) => gate.path && gate.lane && gate.command),
  "engine independence current product gates are incomplete or duplicated");
  await Promise.all(gatePaths.map((path) => access(new URL(`../../${path}`, import.meta.url))));
  const packed = await packedCouplings();
  assert(packed.length === 0, "packed artifact still contains a forbidden engine reference");
}
