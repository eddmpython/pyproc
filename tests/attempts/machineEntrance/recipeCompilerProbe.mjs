// recipeCompilerProbe.mjs - Machine Entrance recipe가 strict manifest authority를 우회하지 않는지 측정한다.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileMachineProfile, serializeMachineProfile } from "../../../scripts/machineEntrance/machineProfile.js";

async function rejected(operation, pattern) {
  let failure = null;
  try { await operation(); } catch (error) { failure = error; }
  if (!failure || !pattern.test(failure.message)) {
    throw new Error(`expected rejection ${pattern}, received ${failure?.message || "success"}`);
  }
}

const root = await mkdtemp(join(tmpdir(), "pyprocMachineEntranceRecipe-"));
try {
  const engineRoot = join(root, "pyodide");
  await mkdir(engineRoot);
  await writeFile(join(engineRoot, "pyodide.js"), "fixture");
  await writeFile(join(engineRoot, "pyodide-lock.json"), "{}");

  const pythonOnly = compileMachineProfile({ recipe: "pythonOnly", engineRoot });
  if (pythonOnly.browser.enabled !== false || Object.keys(pythonOnly.browser).length !== 1) {
    throw new Error("pythonOnly recipe leaked browser authority");
  }

  const observeInput = {
    recipe: "observeLocal",
    engineRoot,
    allowedOrigins: ["http://127.0.0.1:4173"],
    purpose: "inspect the caller-owned local application",
    externalEffects: "acknowledged",
  };
  const observe = compileMachineProfile(observeInput);
  if (observe.browser.actions.join(",") !== "snapshot,screenshot,waitFor"
    || observe.browser.methods.length !== 0 || observe.browser.maxRisk !== "externalEffect") {
    throw new Error("observeLocal recipe did not preserve read-action and navigation authority boundaries");
  }
  if (serializeMachineProfile(observeInput) !== serializeMachineProfile(observeInput)) {
    throw new Error("same recipe input did not produce canonical bytes");
  }

  const actor = compileMachineProfile({
    recipe: "authorizedBrowser",
    engineRoot,
    allowedOrigins: ["https://example.test"],
    actions: ["snapshot", "click"],
    maxRisk: "externalEffect",
    purpose: "verify one authorized workflow",
    externalEffects: "acknowledged",
  });
  if (!actor.browser.actions.includes("click") || actor.browser.purpose !== "verify one authorized workflow") {
    throw new Error("authorizedBrowser recipe lost explicit authority");
  }

  await rejected(() => compileMachineProfile({ recipe: "pythonOnly", engineRoot,
    allowedOrigins: ["https://example.test"] }), /pythonOnly does not accept allowedOrigins/);
  await rejected(() => compileMachineProfile({ ...observeInput, allowedOrigins: ["http://*.test"] }),
    /exact HTTP\(S\) origin/);
  await rejected(() => compileMachineProfile({ ...observeInput, externalEffects: undefined }),
    /requires externalEffects acknowledged/);
  await rejected(() => compileMachineProfile({ recipe: "authorizedBrowser", engineRoot,
    allowedOrigins: ["https://example.test"], actions: ["unknownAction"], maxRisk: "externalEffect",
    purpose: "fixture", externalEffects: "acknowledged" }), /unknown browser action/);
  await rejected(() => compileMachineProfile({ recipe: "authorizedBrowser", engineRoot,
    allowedOrigins: ["https://example.test"], actions: ["click"], maxRisk: "read",
    purpose: "fixture", externalEffects: "acknowledged" }), /exceeds max risk/);
  await rejected(() => compileMachineProfile({ ...observeInput, surprise: true }), /does not accept surprise/);

  console.log("machine entrance recipe probe passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
