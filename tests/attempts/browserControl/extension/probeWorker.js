// probeWorker.js - 프로세스 OS 최소 증명: 확장 안 module Worker가 공유 SAB를 실제로 본다.
// offscreen이 넘긴 SharedArrayBuffer에 Atomics로 42를 쓰고 응답한다. 부모가 같은 뷰에서
// 42를 읽으면 워커와 공유메모리가 실동작 = 워커=프로세스 모델이 확장 문서에서 성립.
self.onmessage = (ev) => {
  try {
    const view = new Int32Array(ev.data.sab);
    Atomics.store(view, 0, 42);
    self.postMessage({ ok: true });
  } catch (e) {
    self.postMessage({ ok: false, error: String(e) });
  }
};
