// heroConsole.js - live landing proof built only on the public owned-kernel API.

const PROMPT = '<span class="ok">&gt;&gt;&gt;</span>';
const dim = (text) => `<span class="dim">${text}</span>`;
const ok = (text) => `<span class="ok">${text}</span>`;
const err = (text) => `<span class="err">${text}</span>`;
const escapeHtml = (text) => String(text).replace(/[&<>]/g,
  (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]);

let machinePromise = null;
async function sharedMachine(ctx) {
  if (machinePromise) return machinePromise;
  machinePromise = (async () => {
    ctx.status("Loading the verified CPython WASI package...");
    const startedAt = performance.now();
    const { boot } = await import("../index.js");
    const machine = await boot({ deterministic: true });
    const versionResult = await machine.run("import sys\nprint(sys.version.split()[0])");
    const version = versionResult.output.trim();
    const elapsed = Math.round(performance.now() - startedAt);
    ctx.status(`CPython <b class="ok">${escapeHtml(version)}</b> is running in an owned worker. Boot: <b class="ok">${elapsed}ms</b>.`);
    return { machine, version };
  })();
  return machinePromise;
}

export const demos = [
  {
    id: "execute",
    label: "Execute",
    action: "Run Python",
    code: [
      dim("# real CPython, isolated behind the kernel protocol"),
      `${PROMPT} sum(i * i for i in range(10))`,
    ],
    async run(ctx) {
      const { machine, version } = await sharedMachine(ctx);
      const result = await machine.run("print(sum(i * i for i in range(10)))");
      ctx.print(`${PROMPT} ${ok(result.output.trim())} ${dim(`# CPython ${version}`)}`);
      return result.output.trim() === "285";
    },
  },
  {
    id: "history",
    label: "History",
    action: "Checkpoint + restore",
    code: [
      dim("# mutate state, then return to the checkpoint"),
      `${PROMPT} value = 41`,
      `${PROMPT} checkpoint = await machine.history.checkpoint()`,
      `${PROMPT} value = 99; await machine.history.restore(checkpoint)`,
    ],
    async run(ctx) {
      const { machine } = await sharedMachine(ctx);
      await machine.run("heroHistoryValue = 41");
      const checkpoint = await machine.history.checkpoint();
      await machine.run("heroHistoryValue = 99");
      await machine.history.restore(checkpoint);
      const restored = await machine.run.get("heroHistoryValue");
      ctx.print(`${PROMPT} restored value: ${ok(restored)}`);
      return restored === 41;
    },
  },
  {
    id: "terminal",
    label: "Terminal",
    action: "Open REPL",
    code: [
      dim("# CPython InteractiveConsole over the kernel protocol"),
      `${PROMPT} value = 40`,
      `${PROMPT} value + 2`,
    ],
    async run(ctx) {
      const { machine } = await sharedMachine(ctx);
      const terminal = machine.terminal({ timeTravel: true });
      await terminal.install();
      await terminal.push("heroTerminalValue = 40");
      const result = await terminal.push("heroTerminalValue + 2");
      ctx.print(`${PROMPT} ${ok(result.out.trim())}`);
      return result.more === false && result.out.trim() === "42";
    },
  },
  {
    id: "process",
    label: "Process",
    action: "Clone process",
    code: [
      dim("# clone the prepared kernel into an independent worker"),
      `${PROMPT} child = await machine.proc.clone()`,
      `${PROMPT} await child.process.execute("print(6 * 7)")`,
    ],
    async run(ctx) {
      const { machine } = await sharedMachine(ctx);
      const cloned = await machine.proc.clone();
      try {
        const result = await cloned.process.execute("print(6 * 7)");
        const exit = await cloned.process.wait();
        ctx.print(`${PROMPT} child output: ${ok(result.output.trim())}`);
        return result.output.trim() === "42" && exit.exitCode === 0;
      } finally {
        await cloned.process.close();
      }
    },
  },
  {
    id: "machine",
    label: "Machine image",
    action: "Export + open",
    code: [
      dim("# the Machine image carries checkpoint state and integrity metadata"),
      `${PROMPT} image = await machine.history.export()`,
      `${PROMPT} revived = await open(image)`,
    ],
    async run(ctx) {
      const { machine } = await sharedMachine(ctx);
      const image = await machine.history.export();
      const { open } = await import("../index.js");
      const revived = await open(image);
      try {
        const result = await revived.run("print('portable')");
        ctx.print(`${PROMPT} ${ok(result.output.trim())} ${dim(image.protocol)}`);
        return result.output.trim() === "portable" && image.protocol === "pyproc.kernel-machine-image";
      } finally {
        await revived.close();
      }
    },
  },
];

export function mountHeroConsole(root, { gateMode = false } = {}) {
  root.innerHTML = `
    <div class="heroTabs" role="tablist"></div>
    <div class="term heroOut" id="heroOut" aria-live="polite"></div>
    <div class="row heroRun">
      <button class="heroGo"></button>
      <span class="status heroStatus">The verified runtime loads only when you run a demo.</span>
    </div>`;
  const tabs = root.querySelector(".heroTabs");
  const output = root.querySelector(".heroOut");
  const button = root.querySelector(".heroGo");
  const status = root.querySelector(".heroStatus");
  let current = demos[0];

  const ctx = {
    gateMode,
    print(html) {
      output.insertAdjacentHTML("beforeend", `${output.innerHTML ? "\n" : ""}${html}`);
      output.scrollTop = output.scrollHeight;
    },
    status(html) { status.innerHTML = html; },
  };

  function showTab(demo) {
    current = demo;
    for (const tab of tabs.children) tab.classList.toggle("on", tab.dataset.id === demo.id);
    output.innerHTML = demo.code.join("\n");
    button.textContent = demo.action;
    button.disabled = false;
  }

  async function run() {
    button.disabled = true;
    try {
      const passed = await current.run(ctx);
      button.textContent = "Run again";
      return passed;
    } catch (error) {
      const message = String(error?.message || error).split("\n")[0];
      ctx.print(err(escapeHtml(message)));
      ctx.status(`Failed: ${escapeHtml(message)}`);
      return false;
    } finally {
      button.disabled = false;
    }
  }

  for (const demo of demos) {
    const tab = document.createElement("button");
    tab.className = "heroTab";
    tab.dataset.id = demo.id;
    tab.textContent = demo.label;
    tab.setAttribute("role", "tab");
    tab.addEventListener("click", () => showTab(demo));
    tabs.append(tab);
  }
  button.addEventListener("click", run);
  showTab(demos[0]);
  return { run, showTab, demos, ctx };
}
