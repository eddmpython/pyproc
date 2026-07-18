// 부활 통합 동사 open({ persistent })가 옛 openPersistentMachine의 설치 표면이다(state-kernel 7b).
import { open } from "pyproc";

const waitFor = async (predicate, timeoutMs, stepMs = 50) => {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return null;
};

const percentile = (values, ratio) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))].toFixed(2);
};

export async function runImmortalProductGate(opts = {}) {
  const checks = [];
  const timings = {};
  const check = (name, pass, info = "") => checks.push({ name, pass: !!pass, info: String(info) });
  const machineName = `installedImmortal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const tabs = new Map();
  const statuses = new Map();
  const statusEvents = [];
  let sequence = 0;

  const onMessage = (event) => {
    const message = event.data;
    if (!message || message.from !== "productMachineParticipant") return;
    if (message.event === "status") {
      statuses.set(message.participantId, message.status);
      statusEvents.push({ participantId: message.participantId, status: message.status, time: performance.now() });
      return;
    }
    if (!message.requestId) return;
    for (const tab of tabs.values()) {
      const pending = tab.pending.get(message.requestId);
      if (!pending) continue;
      tab.pending.delete(message.requestId);
      if (message.ok) pending.resolve(message);
      else {
        const error = new Error(message.error);
        error.code = message.code;
        error.retryable = message.retryable;
        error.status = message.status;
        pending.reject(error);
      }
      break;
    }
  };
  addEventListener("message", onMessage);

  const makeParticipant = (participantId) => new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    const pending = new Map();
    tabs.set(participantId, { frame, pending });
    const onReady = (event) => {
      if (event.data?.from !== "productMachineParticipant" || event.data.event !== "ready" || event.source !== frame.contentWindow) return;
      removeEventListener("message", onReady);
      resolve();
    };
    addEventListener("message", onReady);
    const query = opts.indexURL ? `?indexURL=${encodeURIComponent(opts.indexURL)}` : "";
    frame.src = "/immortalProductParticipant.html" + query;
    document.body.appendChild(frame);
  });

  const command = (participantId, payload) => {
    const tab = tabs.get(participantId);
    if (!tab) return Promise.reject(new Error("missing participant " + participantId));
    const requestId = "installed-immortal-" + (++sequence);
    return new Promise((resolve, reject) => {
      tab.pending.set(requestId, { resolve, reject });
      tab.frame.contentWindow.postMessage({
        to: "productMachineParticipant",
        participantId,
        requestId,
        ...payload,
      }, "*");
    });
  };

  const removeParticipant = (participantId) => {
    const tab = tabs.get(participantId);
    if (!tab) return;
    tab.frame.remove();
    tabs.delete(participantId);
    statuses.delete(participantId);
  };

  try {
    // 검사 의미: 멀티탭 영속 머신 진입점이 설치 패키지의 public 표면인가(지금은 open({ persistent })).
    check("openPersistentMachine is installed public surface", typeof open === "function");
    const initialStarted = performance.now();
    await Promise.all([makeParticipant("A"), makeParticipant("B"), makeParticipant("C")]);
    const joined = await Promise.all(["A", "B", "C"].map((participantId) => command(participantId, {
      cmd: "join", name: machineName,
    })));
    timings.immortalInitialReadyMs = Math.round(performance.now() - initialStarted);
    const initialStatuses = joined.map((entry) => entry.status);
    const leader = initialStatuses.find((status) => status.role === "leader");
    const leaderId = leader?.leaderId;
    const initialEpoch = leader?.epoch;
    const followers = ["A", "B", "C"].filter((participantId) => participantId !== leaderId);
    const sharedIdentity = initialStatuses.every((status) =>
      status.name === machineName && status.leaderId === leaderId && status.epoch === initialEpoch && status.phase === "ready"
    );
    check("installed machine elects exactly one leader across browsing contexts",
      initialStatuses.filter((status) => status.role === "leader").length === 1 && sharedIdentity,
      `leader=${leaderId}, epoch=${initialEpoch}`);
    check("installed canonical kernel preserves COI and JSPI",
      initialStatuses.every((status) => status.crossOriginIsolated && status.jspi),
      `coi=${leader?.crossOriginIsolated}, jspi=${leader?.jspi}`);

    await command(followers[0], { cmd: "run", code: [
      "import os",
      "os.makedirs('/home/web/productImmortal', exist_ok=True)",
      "productSharedValue = 41",
      "open('/home/web/productImmortal/state.txt', 'w').write('installed-survives')",
    ].join("\n") });
    const shared = await command(followers[1], {
      cmd: "run",
      code: "f'{productSharedValue + 1}|{open(\"/home/web/productImmortal/state.txt\").read()}|{productPrepared}|' + json.dumps({'lane': 'prepared'}, sort_keys=True)",
    });
    const collisionPair = await Promise.all([
      command(followers[0], { cmd: "run", code: "'installed-left'" }),
      command(followers[1], { cmd: "run", code: "'installed-right'" }),
    ]);
    check("installed participants share memory, home, prepared environment and collision-free request IDs",
      shared.result === '42|installed-survives|7|{"lane": "prepared"}' &&
      collisionPair[0].result === "installed-left" && collisionPair[1].result === "installed-right",
      `${shared.result} | ${collisionPair.map((entry) => entry.result).join("/")}`);

    const rpcSamples = [];
    for (let i = 0; i < 20; i++) {
      const started = performance.now();
      await command(followers[0], { cmd: "run", code: "6 * 7" });
      rpcSamples.push(performance.now() - started);
    }
    timings.immortalRpcP50Ms = percentile(rpcSamples, 0.5);
    timings.immortalRpcP90Ms = percentile(rpcSamples, 0.9);
    const lateOutcome = await command(followers[0], {
      cmd: "run", code: "import asyncio\nawait asyncio.sleep(0.2)\n'installed-late'", async: true, timeoutMs: 50,
    }).then((result) => ({ ok: true, result }), (error) => ({ ok: false, error }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const afterLate = await command(followers[1], { cmd: "run", code: "6 * 7" });

    const commit = await command(followers[0], { cmd: "commit", timeoutMs: 12000 });
    check("installed follower commits heap and home through leader",
      !!commit.commit?.committedAt && commit.commit?.home?.files >= 1,
      `pages=${commit.commit?.pages}, homeFiles=${commit.commit?.home?.files}`);

    const uncertainRequest = command(followers[0], {
      cmd: "run",
      code: "import asyncio\nawait asyncio.sleep(10)\nproductUncertain = globals().get('productUncertain', 0) + 1\nproductUncertain",
      async: true,
      timeoutMs: 7000,
    }).then((result) => ({ ok: true, result }), (error) => ({ ok: false, error }));
    await waitFor(() => statuses.get(followers[0])?.pendingRequests === 1, 2000);
    const killedAt = performance.now();
    removeParticipant(leaderId);
    const promotedEvent = await waitFor(() => statusEvents.find((entry) =>
      entry.time >= killedAt && entry.status.phase === "ready" && entry.status.epoch > initialEpoch && entry.status.leaderId !== leaderId
    ), 7000);
    timings.immortalFailoverMs = promotedEvent ? Math.round(promotedEvent.time - killedAt) : -1;
    timings.immortalRecoveryMs = promotedEvent?.status.recoveryMs ?? -1;
    const promoted = promotedEvent?.status;
    const survivors = followers.filter((participantId) => tabs.has(participantId));
    const survivorStatuses = await Promise.all(survivors.map((participantId) => command(participantId, { cmd: "status" })));
    const afterFailover = await command(survivors[0], {
      cmd: "run",
      code: "f'{productSharedValue}|{open(\"/home/web/productImmortal/state.txt\").read()}|{productPrepared}|' + json.dumps({'lane': 'prepared'}, sort_keys=True)",
      timeoutMs: 9000,
    });
    check("installed machine survives forced leader context removal",
      !!promoted && timings.immortalFailoverMs < 5000 && promoted.epoch === initialEpoch + 1 && promoted.recovered === true &&
      survivorStatuses.filter((entry) => entry.status.role === "leader").length === 1 &&
      afterFailover.result === '41|installed-survives|7|{"lane": "prepared"}',
      `leader=${promoted?.leaderId}, epoch=${promoted?.epoch}, failover=${timings.immortalFailoverMs}ms`);

    const uncertain = await uncertainRequest;
    const pendingAfter = await command(followers[0], { cmd: "status" });
    const uncertainValue = await command(survivors[1], { cmd: "run", code: "globals().get('productUncertain', 0)" });
    check("installed timeout/failover RPC rejects unknown outcome, ignores late response and never replays",
      uncertain.ok === false && uncertain.error.code === "PYPROC_RPC_OUTCOME_UNKNOWN" && uncertain.error.retryable === false &&
      pendingAfter.status.pendingRequests === 0 && uncertainValue.result === 0 && lateOutcome.ok === false &&
      lateOutcome.error.code === "PYPROC_RPC_OUTCOME_UNKNOWN" && afterLate.result === 42,
      uncertain.ok ? "unexpected success" : `${uncertain.error.code}, late=${lateOutcome.ok ? "unexpected" : lateOutcome.error.code}, pending=${pendingAfter.status.pendingRequests}`);

    await command(survivors[0], { cmd: "run", code: [
      "productColdValue = 99",
      "open('/home/web/productImmortal/state.txt', 'w').write('installed-cold')",
    ].join("\n") });
    const coldCommit = await command(survivors[1], { cmd: "commit", timeoutMs: 12000 });
    const previousEpoch = coldCommit.status.epoch;
    for (const participantId of survivors) removeParticipant(participantId);
    const reopenStarted = performance.now();
    await makeParticipant("D");
    const reopened = await command("D", { cmd: "join", name: machineName });
    timings.immortalColdReopenMs = Math.round(performance.now() - reopenStarted);
    const reopenedValue = await command("D", {
      cmd: "run",
      code: "f'{productSharedValue}|{productColdValue}|{open(\"/home/web/productImmortal/state.txt\").read()}|{productPrepared}|' + json.dumps({'lane': 'prepared'}, sort_keys=True)",
    });
    check("installed machine cold-reopens committed heap and home after all participants close",
      reopened.status.role === "leader" && reopened.status.recovered === true && reopened.status.epoch === previousEpoch + 1 &&
      reopened.status.lastCommitAt === coldCommit.commit.committedAt &&
      reopenedValue.result === '41|99|installed-cold|7|{"lane": "prepared"}',
      `epoch=${reopened.status.epoch}, value=${reopenedValue.result}, reopen=${timings.immortalColdReopenMs}ms`);
    await command("D", { cmd: "leave" });
    removeParticipant("D");
  } catch (error) {
    check("installed immortal machine uncaught", false, String(error.stack || error).slice(-500));
  } finally {
    for (const participantId of [...tabs.keys()]) {
      try { await command(participantId, { cmd: "leave" }); } catch (error) {}
      removeParticipant(participantId);
    }
    removeEventListener("message", onMessage);
  }
  return { checks, timings };
}
