import { ensureCrossOriginIsolation } from "./coiBootstrap.js";
import { boot, open } from "../index.js";

await ensureCrossOriginIsolation();

const output = document.getElementById("output");
const status = document.getElementById("status");
const runButton = document.getElementById("run");
const scenario = document.body.dataset.scenario;

function write(line) {
  output.textContent += `${output.textContent ? "\n" : ""}${line}`;
}

async function runScenario() {
  let machine = null;
  let revived = null;
  let child = null;
  try {
    status.textContent = "Loading the verified CPython WASI package...";
    machine = await boot({ deterministic: true });
    const inspection = await machine.inspect();
    write(`kernel: ${inspection.kernel.runtimeKind}, workerOwned=${inspection.kernel.workerOwned}`);

    if (scenario === "basic") {
      const result = await machine.run("print(sum(i * i for i in range(10)))");
      write(`Python result: ${result.output.trim()}`);
      return result.output.trim() === "285";
    }
    if (scenario === "history" || scenario === "immortal") {
      await machine.run("demoValue = 41");
      const checkpoint = await machine.history.checkpoint();
      await machine.run("demoValue = 99");
      await machine.history.restore(checkpoint);
      const restored = await machine.run.get("demoValue");
      write(`restored: ${restored}`);
      if (scenario === "history") return restored === 41;
      const image = await machine.history.export();
      revived = await open(image);
      const reopened = await revived.run.get("demoValue");
      write(`reopened: ${reopened}`);
      return reopened === 41;
    }
    if (scenario === "terminal") {
      const terminal = machine.terminal({ timeTravel: true });
      await terminal.install();
      const result = await terminal.push("print(6 * 7)");
      write(`>>> ${result.out.trim()}`);
      return result.out.trim() === "42";
    }
    if (scenario === "image") {
      await machine.run.set("portableValue", { answer: 42, label: "portable" });
      const image = await machine.history.export();
      revived = await open(image);
      const value = await revived.run.get("portableValue");
      write(`image: ${image.protocol}`);
      write(`value: ${JSON.stringify(value)}`);
      return image.protocol === "pyproc.kernel-machine-image" && value.answer === 42;
    }
    if (scenario === "process") {
      await machine.run("preparedValue = 40");
      const cloned = await machine.proc.clone();
      child = cloned.process;
      const result = await child.execute("print(preparedValue + 2)");
      const exit = await child.wait();
      write(`child ${child.pid}: ${result.output.trim()}, exit=${exit.exitCode}`);
      return result.output.trim() === "42" && exit.exitCode === 0;
    }
    if (scenario === "server") {
      const result = await machine.run([
        "import json",
        "response = {'status': 200, 'body': {'message': 'served inside CPython'}}",
        "print(json.dumps(response, sort_keys=True))",
      ].join("\n"));
      const response = JSON.parse(result.output);
      write(`response: ${result.output.trim()}`);
      return response.status === 200 && response.body.message === "served inside CPython";
    }
    if (scenario === "speed") {
      const startedAt = performance.now();
      let last = null;
      for (let index = 0; index < 100; index += 1) last = await machine.run(`speedValue = ${index}`);
      const elapsed = Math.round(performance.now() - startedAt);
      write(`100 ordered commands: ${elapsed}ms`);
      return last.state === "completed" && await machine.run.get("speedValue") === 99;
    }
    if (scenario === "control") {
      const result = await machine.kernel.inspect();
      write(`protocol: ${result.protocol}`);
      write(`state: ${result.state}`);
      return result.protocol === "pyproc.inspection-result" && result.state === "completed";
    }
    throw new Error(`Unknown demo scenario: ${scenario}`);
  } finally {
    if (child && child.state === "running") await child.close();
    if (revived) await revived.close();
    if (machine) await machine.close();
  }
}

async function run() {
  runButton.disabled = true;
  output.textContent = "";
  let pass = false;
  let info = "";
  try {
    pass = await runScenario();
    status.textContent = pass ? "Contract verified in this browser." : "The scenario returned an unexpected result.";
  } catch (error) {
    info = `${error?.code || ""} ${error?.message || error}`.trim();
    write(info);
    status.textContent = "The scenario failed.";
  } finally {
    runButton.disabled = false;
  }
  if (new URLSearchParams(location.search).has("gate")) {
    await fetch("/gateReport", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: pass, checks: [{ name: scenario, pass, info }] }) });
  }
  return pass;
}

runButton.addEventListener("click", run);
if (new URLSearchParams(location.search).has("gate")) run();
