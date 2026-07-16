// webComputerContextSwap.js - 완성된 candidate만 active context로 교체하고 실패하면 기존 실행을 복구한다.
export async function swapWebComputerContext({ current, createCandidate, stageCandidate, commitCandidate, control }) {
  if (!current) throw new TypeError("current context가 필요하다");
  if (typeof createCandidate !== "function") throw new TypeError("createCandidate가 필요하다");
  if (typeof stageCandidate !== "function") throw new TypeError("stageCandidate가 필요하다");
  if (typeof commitCandidate !== "function") throw new TypeError("commitCandidate가 필요하다");
  const runningIds = current.runningMachineIds();
  try {
    await current.pauseRunning(control);
  } catch (error) {
    await current.resumeMachineIds(runningIds).catch(() => undefined);
    throw error;
  }
  let candidate = null;
  try {
    candidate = createCandidate();
    await stageCandidate(candidate);
    await candidate.resumeAll(control);
    candidate.activate();
    commitCandidate(candidate);
    current.deactivate();
  } catch (error) {
    if (candidate) await candidate.dispose().catch(() => undefined);
    current.activate();
    await current.resumeMachineIds(runningIds);
    throw error;
  }
  let cleanupError = null;
  try {
    await current.dispose();
  } catch (error) {
    cleanupError = error;
  }
  return Object.freeze({ context: candidate, cleanupError });
}
