// heroConsole.js - 랜딩 히어로의 라이브 콘솔(데모 실행 표면의 정본).
// 랜딩에서 데모를 "보여주지" 않고 "돌린다". 탭을 넘나들어도 런타임은 하나다:
// 첫 탭에서 CPython을 한 번 부팅하고, 나머지 탭은 그 상태 위에서 곧바로 돈다.
// 그게 이 제품의 주장 자체이므로(한 번 준비하고 계속 재사용), 화면이 그 주장을 증명한다.
//
// 엔진은 누르기 전에 내려받지 않는다: pyproc import 자체를 첫 실행 시점으로 미룬다(동적 import).
// 랜딩 첫 로드에는 파이썬이 없다.
//
// 숫자는 전부 그 자리에서 잰다(하드코딩 0). 데모가 실패하면 그대로 보여준다: 데모의 값은
// "진짜로 돈다"는 증거뿐이라, 실패를 숨기면 남는 게 없다.

const PROMPT = '<span class="ok">&gt;&gt;&gt;</span>';
const dim = (t) => `<span class="dim">${t}</span>`;
const ok = (t) => `<span class="ok">${t}</span>`;
const err = (t) => `<span class="err">${t}</span>`;
const ms = (t) => `${t.toFixed(1)}ms`;
const pageIndexURL = () => {
  const indexParam = new URLSearchParams(location.search).get("indexURL");
  return indexParam ? new URL(indexParam, location.href).href : undefined;
};

// 공유 머신. 결정적 리플레이로 부팅한다: 머신 탭(최면/부활/이미지 내보내기 = history.save/export)이
// 결정 부팅을 전제하므로, 모든 탭이 같은 머신 핸들 하나를 쓴다.
let machinePromise = null;
async function sharedMachine(ctx) {
  if (machinePromise) return machinePromise;
  machinePromise = (async () => {
    ctx.status("Downloading CPython (WebAssembly)...");
    const t0 = performance.now();
    const { boot } = await import("../index.js");
    const machine = await boot({ deterministic: true, indexURL: pageIndexURL() });
    const bootMs = performance.now() - t0;
    const version = machine.run("import sys; sys.version.split()[0]");
    ctx.status(`CPython <b class="ok">${version}</b> booted in this tab in <b class="ok">${Math.round(bootMs)}ms</b>. Every tab below now shares it.`);
    return { machine, bootMs, version };
  })();
  return machinePromise;
}

export const demos = [
  {
    id: "timeTravel",
    label: "Time travel",
    action: "Run it",
    code: [
      dim("# checkpoint, wreck it, travel back. the agent retry loop."),
      `${PROMPT} data = list(range(1_000_000))   ${dim("# the prepared state")}`,
      `${PROMPT} cp = checkpoint()               ${dim("# a point to return to")}`,
      `${PROMPT} data.clear()                    ${dim("# an agent wrecks it")}`,
      `${PROMPT} restore(cp)                     ${dim("# changed pages only")}`,
      `${PROMPT} len(data)                       ${dim("# whole again, no re-run")}`,
    ],
    async run(ctx) {
      const { machine } = await sharedMachine(ctx);
      machine.run("data = list(range(1_000_000))");
      const cp = machine.history.checkpoint();
      const prepared = machine.run("len(data)");
      ctx.print("");
      ctx.print(`${PROMPT} len(data)  ${ok(prepared.toLocaleString())}  ${dim("# prepared, checkpoint saved")}`);

      machine.run("data.clear()");
      const wrecked = machine.run("len(data)");
      ctx.print(`${PROMPT} len(data)  ${err(wrecked)}        ${dim("# the agent wrecked it")}`);

      machine.history.checkpoint();            // 실행 경계를 닫는다(복원을 건전하게 만드는 계약)
      const t = performance.now();
      machine.history.restore(cp);
      const restoreMs = performance.now() - t;
      const restored = machine.run("len(data)");
      ctx.print(`${PROMPT} len(data)  ${ok(restored.toLocaleString())}  ${dim(`# restored in ${ms(restoreMs)}, no re-run`)}`);
      ctx.status(`Heap time-travel in <b class="ok">${ms(restoreMs)}</b>. No re-boot, no re-run.`);
      return prepared === 1000000 && wrecked === 0 && restored === 1000000;
    },
  },
  {
    id: "terminal",
    label: "Terminal",
    action: "Start the REPL",
    code: [
      dim("# a real REPL: CPython's own InteractiveConsole, in this tab."),
      `${PROMPT} name = input("who? ")   ${dim("# input() genuinely blocks (JSPI)")}`,
      `${PROMPT} x = 41                  ${dim("# then: %undo")}`,
      `${PROMPT} %undo                   ${dim("# time-travel the heap, not the text")}`,
    ],
    async run(ctx) {
      const { machine } = await sharedMachine(ctx);
      const term = await ctx.terminal(machine);
      ctx.print("");
      ctx.print(dim(`# type below. try: x = 41  then  %undo  then  x`));
      if (ctx.gateMode) {
        const a = await term.push("x = 40");
        const b = await term.push("x + 2");
        const u = await term.push("%undo");
        const c = await term.push("x");
        ctx.print(`${PROMPT} x = 40 -> x + 2  ${ok(b.out.trim())}   %undo -> x  ${ok(c.out.trim() || "NameError")}`);
        return b.out.trim() === "42" && !u.more;
      }
      ctx.showInput(async (line) => {
        ctx.print(`${PROMPT} ${escapeHtml(line)}`);
        const r = await term.push(line);
        if (r.out) ctx.print(escapeHtml(r.out.replace(/\n$/, "")));
        return r.more;
      });
      ctx.status("REPL live. <b class=\"ok\">input()</b> blocks for real, <b class=\"ok\">%undo</b> travels the heap.");
      return true;
    },
  },
  {
    id: "agent",
    label: "Agent loop",
    action: "Run the loop",
    code: [
      dim("# prepare once (numpy + data), then fail, restore, and branch."),
      `${PROMPT} data = np.arange(1, 101)   ${dim("# the expensive prepared state")}`,
      `${PROMPT} cp = checkpoint()          ${dim("# the agent attempt starts here")}`,
      `${PROMPT} data = data * 0            ${dim("# buggy code corrupts it")}`,
      `${PROMPT} restore(cp); branch(A); restore(cp); branch(B)`,
    ],
    async run(ctx) {
      const { machine } = await sharedMachine(ctx);
      ctx.status("Loading numpy into the running interpreter...");
      const tn = performance.now();
      await machine.runtime.loadPackages(["numpy"]);
      machine.run("import numpy as np");
      const numpyMs = performance.now() - tn;
      ctx.print("");
      ctx.print(dim(`# numpy loaded in ${Math.round(numpyMs)}ms, into the interpreter that is already running`));

      machine.run("data = np.arange(1, 101)");
      const baseline = machine.run("int(data.sum())");
      const cp = machine.history.checkpoint();
      ctx.print(`${PROMPT} data.sum()  ${ok(baseline)}  ${dim("# prepared, checkpoint saved")}`);

      machine.run("data = data * 0   # the agent zeroed the dataset");
      const broken = machine.run("int(data.sum())");
      ctx.print(`${PROMPT} data.sum()  ${err(broken)}     ${dim("# attempt #1 corrupted the state")}`);

      machine.history.checkpoint();
      const t = performance.now();
      machine.history.restore(cp);
      const restoreMs = performance.now() - t;
      const restored = machine.run("int(data.sum())");
      ctx.print(`${PROMPT} data.sum()  ${ok(restored)}  ${dim(`# restored in ${ms(restoreMs)}, no re-install, no re-run`)}`);

      const meanA = machine.run("round(float(data.mean()), 2)");
      machine.history.checkpoint();
      machine.history.restore(cp);
      const sumB = machine.run("int(data[data > 50].sum())");
      ctx.print(`${PROMPT} branch A: data.mean()  ${ok(meanA)}     ${dim("# both branches start from")}`);
      ctx.print(`${PROMPT} branch B: data[data>50].sum()  ${ok(sumB)}  ${dim("# the same prepared state")}`);
      ctx.status(`One prepared state served a failed attempt, a restore, and two branches. Restore: <b class="ok">${ms(restoreMs)}</b>.`);
      return baseline === 5050 && broken === 0 && restored === 5050 && Math.abs(meanA - 50.5) < 1e-6 && sumB === 3775;
    },
  },
  {
    id: "parallel",
    label: "Parallel",
    action: "Fork 4 workers",
    code: [
      dim("# Web Worker = process. one snapshot forks into N interpreters."),
      `${PROMPT} pool = await machine.proc({lanes: 4})  ${dim("# 4 GILs, 4 real cores")}`,
      `${PROMPT} await pool.map(fn, [n, n, n, n])       ${dim("# parallel")}`,
      `${PROMPT} [await pool.exec(pid, fn, n) ...]      ${dim("# same work, one worker")}`,
    ],
    async run(ctx) {
      if (!crossOriginIsolated) {
        // SharedArrayBuffer는 crossOriginIsolated에서만 열린다. GitHub Pages는 헤더를 못 달므로
        // 번들 서비스워커가 헤더를 주입하고 한 번 새로고침한다(실측: swCoiProbe). 돌아오면 이 탭을 다시 연다.
        ctx.print("");
        ctx.print(dim("# SharedArrayBuffer is locked on this host. Unlocking with the bundled"));
        ctx.print(dim("# service worker, then reloading once (this is what a product ships)."));
        ctx.status("Unlocking SharedArrayBuffer (one-time reload)...");
        sessionStorage.setItem("pyprocHeroTab", "parallel");
        await navigator.serviceWorker.register(new URL("../pyprocSw.js?coi=1", import.meta.url));
        await navigator.serviceWorker.ready;
        location.reload();
        await new Promise(() => {}); // 새 문서로 넘어갈 때까지 정지
      }
      const { machine } = await sharedMachine(ctx);
      ctx.status("Forking 4 interpreters from one memory snapshot...");
      const tp = performance.now();
      const pool = await machine.proc({ lanes: 4 });
      const workers = pool.ps().length;
      ctx.print("");
      ctx.print(dim(`# ${workers} workers forked from one snapshot in ${Math.round(performance.now() - tp)}ms`));

      const fn = "def _fn(n):\n    return sum(i*i for i in range(n))";
      const args = [2000000, 2000000, 2000000, 2000000];
      let t = performance.now();
      const par = await pool.map(fn, args);
      const parMs = performance.now() - t;
      t = performance.now();
      // 직렬 기준선: 같은 태스크를 워커 1개에서 exec로 순차 실행(공개 표면만 사용).
      const serialPid = pool.ps().find((p) => p.state === "ready").pid;
      const ser = [];
      for (const a of args) ser.push(await pool.exec(serialPid, fn, a));
      const serMs = performance.now() - t;
      // 2^53을 넘는 파이썬 int는 BigInt로 온다(정밀도 보존이 올바른 동작).
      const same = par.length === ser.length && par.every((v, i) => v === ser[i]);
      ctx.print(`${PROMPT} parallel (4 workers)  ${ok(Math.round(parMs) + "ms")}`);
      ctx.print(`${PROMPT} serial   (1 worker)   ${ok(Math.round(serMs) + "ms")}   ${dim(`# same results: ${same}`)}`);
      pool.terminate();
      ctx.status(`<b class="ok">${(serMs / parMs).toFixed(2)}x</b> on real cores. Same values, ${workers} independent GILs.`);
      return same && workers === 4;
    },
  },
  {
    id: "machine",
    label: "Machine",
    action: "Run + hibernate",
    code: [
      dim("# the whole computer is a file. close the tab: it hibernates."),
      `${PROMPT} n = globals().get('n', 0) + 1   ${dim("# state that outlives the tab")}`,
      `${PROMPT} open('/home/web/visits.txt', 'a').write(...)`,
      `${PROMPT} await machine.history.save(opfs)   ${dim("# heap delta -> disk")}`,
      `${PROMPT} await machine.history.export()     ${dim("# one .pymachine file")}`,
    ],
    async run(ctx) {
      const { machine } = await sharedMachine(ctx);
      const persisted = await ctx.machine(machine);
      const n = machine.run(
        "n = globals().get('n', 0) + 1\n" +
        "open('/home/web/visits.txt', 'a').write(f'visit {n}\\n')\n" +
        "n",
      );
      const lines = machine.run("len(open('/home/web/visits.txt').readlines())");
      ctx.print("");
      ctx.print(`${PROMPT} counter  ${ok(n)}   ${dim(`# visits.txt now has ${lines} line(s) on a real disk (OPFS)`)}`);

      const saved = await persisted.hibernate();
      ctx.print(`${PROMPT} machine.history.save()  ${ok(`${saved.pages} pages / ${saved.mb}MB`)}  ${dim("# hibernated")}`);
      ctx.print(dim("# close this tab and come back: the counter keeps counting."));
      ctx.status(`Hibernated to disk. This tab now wakes up where it left off. Export it and the file <b class="ok">is</b> the computer.`);
      ctx.showExport(persisted);
      return n >= 1 && saved.pages > 0;
    },
  },
];

const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// 콘솔을 그린다(탭 + 터미널 + 실행 줄). 마크업 정의처는 여기 하나다.
export function mountHeroConsole(root, { gateMode = false } = {}) {
  root.innerHTML = `
    <div class="heroTabs" role="tablist"></div>
    <div class="term heroOut" id="heroOut" aria-live="polite"></div>
    <div class="row heroRun">
      <button class="heroGo"></button>
      <span class="status heroStatus">Real CPython, booted here. Nothing downloads until you press it.</span>
    </div>
    <div class="row heroLine" hidden><span class="ps ok">&gt;&gt;&gt;</span><input class="line" aria-label="python input" autocomplete="off" spellcheck="false"></div>`;
  const tabsEl = root.querySelector(".heroTabs");
  const out = root.querySelector(".heroOut");
  const goBtn = root.querySelector(".heroGo");
  const statusEl = root.querySelector(".heroStatus");
  const lineRow = root.querySelector(".heroLine");
  const lineInput = root.querySelector(".line");
  let current = demos[0];
  let terminalCache = null;
  let machineCache = null;
  let pendingInput = null;

  const ctx = {
    gateMode,
    print: (html) => { out.insertAdjacentHTML("beforeend", (out.innerHTML ? "\n" : "") + html); out.scrollTop = out.scrollHeight; },
    status: (html) => { statusEl.innerHTML = html; },
    // 터미널: 입력줄을 그대로 파이썬의 입력 소스로 빌려준다(input()이 진짜로 멈춘다).
    // syscall bridge는 machine.runtime 탈출구, REPL은 machine.term이 정본이다.
    terminal: async (machine) => {
      if (terminalCache) return terminalCache;
      await machine.runtime.enableSyscallBridge({
        inputAsync: (prompt) => new Promise((resolve) => {
          root.querySelector(".ps").textContent = prompt || "input";
          pendingInput = resolve;
        }),
      }).install();
      const term = machine.term({ timeTravel: true });
      await term.install();
      terminalCache = term;
      return term;
    },
    // 머신: OPFS에 최면(history.save)하고 .pymachine(history.export)으로 내보낸다.
    machine: async (machine) => {
      if (machineCache) return machineCache;
      const opfs = await navigator.storage.getDirectory();
      const stateDir = await opfs.getDirectoryHandle("pyprocHeroState", { create: true });
      const homeDir = await opfs.getDirectoryHandle("pyprocHeroHome", { create: true });
      const home = await machine.runtime.mountHome(homeDir);
      machineCache = {
        machine,
        hibernate: async () => { const r = await machine.history.save(stateDir, "heroMachine"); await home.sync(); return r; },
      };
      // 탭이 사라질 때 자동 최면(머신 탭을 실제로 쓴 다음부터만 건다).
      addEventListener("pagehide", () => { machineCache.hibernate(); });
      return machineCache;
    },
    showInput: (onLine) => {
      lineRow.hidden = false;
      lineInput.focus();
      lineInput.onkeydown = async (e) => {
        if (e.key !== "Enter") return;
        const line = lineInput.value;
        lineInput.value = "";
        if (pendingInput) { // 파이썬이 input()으로 멈춰 있다: 이 줄이 그 반환값이다
          const resolve = pendingInput;
          pendingInput = null;
          root.querySelector(".ps").textContent = ">>>";
          ctx.print(dim(escapeHtml(line)));
          resolve(line);
          return;
        }
        lineInput.disabled = true;
        try { await onLine(line); } catch (e2) { ctx.print(err(escapeHtml(String(e2).split("\n").slice(-1)[0]))); }
        lineInput.disabled = false;
        lineInput.focus();
      };
    },
    showExport: (persisted) => {
      if (root.querySelector(".heroExport")) return;
      const btn = document.createElement("button");
      btn.className = "ghost heroExport";
      btn.textContent = "Export .pymachine";
      btn.onclick = async () => {
        const blob = await persisted.machine.history.export();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "computer.pymachine";
        a.click();
        ctx.print(dim(`# exported computer.pymachine (${(blob.size / 1048576).toFixed(1)}MB). that file IS this computer.`));
      };
      goBtn.after(btn);
    },
  };

  const showTab = (demo) => {
    current = demo;
    for (const b of tabsEl.children) b.classList.toggle("on", b.dataset.id === demo.id);
    out.innerHTML = demo.code.join("\n");
    goBtn.textContent = demo.action;
    goBtn.disabled = false;
    lineRow.hidden = true;
    root.querySelector(".heroExport")?.remove();
  };

  const run = async () => {
    goBtn.disabled = true;
    try {
      const passed = await current.run(ctx);
      goBtn.textContent = "Run again";
      goBtn.disabled = false;
      return passed;
    } catch (e) {
      ctx.status(`${err("Failed: " + String(e).split("\n")[0])} (needs Chromium/Edge)`);
      goBtn.disabled = false;
      return false;
    }
  };

  for (const demo of demos) {
    const b = document.createElement("button");
    b.className = "heroTab";
    b.dataset.id = demo.id;
    b.textContent = demo.label;
    b.setAttribute("role", "tab");
    b.onclick = () => showTab(demo);
    tabsEl.append(b);
  }
  goBtn.onclick = run;
  showTab(demos[0]);

  // SAB 잠금 해제 새로고침에서 돌아왔으면 그 탭을 다시 연다(사용자는 흐름이 끊긴 걸 못 느낀다).
  const resumed = sessionStorage.getItem("pyprocHeroTab");
  if (resumed) {
    sessionStorage.removeItem("pyprocHeroTab");
    const demo = demos.find((d) => d.id === resumed);
    if (demo) { showTab(demo); run(); }
  }
  return { run, showTab, demos, ctx };
}
