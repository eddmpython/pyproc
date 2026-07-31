// canvasRgbaFrameSink.js - Layer 5/platform: display 장치가 present한 RGBA8888 프레임을 canvas에 그린다.
//
// canvasRgbaFrameSource의 대칭짝이다: 저쪽은 canvas에 그려진 것을 바이트로 내보내고(캡처 방향),
// 이쪽은 guest가 내놓은 바이트를 화면에 올린다(소비 방향). 소비 방향이 없던 동안 프레임버퍼는
// "만들어지지만 아무도 못 보는" 장치였다: 제품이 매번 자기 putImageData 배선을 다시 써야 했고,
// 그 배선이 저장소에 없으니 화면 경로에는 게이트도 0이었다.
//
// 이 클래스가 소유하는 것은 셋뿐이다.
//  1. **크기의 정본은 프레임이다.** guest가 해상도를 바꾸면 canvas가 따라간다(반대가 아니다).
//  2. **오래된 프레임은 건너뛴다.** revision이 앞서지 않으면 그리지 않는다: 구독 알림과 초기
//     readFrame이 겹칠 때 같은 프레임을 두 번 그리거나 뒤늦은 프레임이 새 것을 덮는 것을 막는다.
//  3. **리스너 안에서 던지지 않는다.** display 장치는 리스너 오류를 세어 계약 위반으로 드러내므로
//     (listenerErrors), 그리기 실패는 여기서 세고 inspect로 보고한다.
import { WebMachineError } from "../contracts/webMachineError.js";

export class CanvasRgbaFrameSink {
  constructor({ canvas, device }) {
    if (!canvas || typeof canvas.getContext !== "function") throw new TypeError("a canvas is required");
    if (!device || device.kind !== "display" || device.mode !== "rgba-frame" || typeof device.subscribe !== "function") {
      throw new TypeError("an rgba-frame display device is required");
    }
    const context = canvas.getContext("2d", { alpha: false });
    if (!context || typeof context.putImageData !== "function") throw new TypeError("a 2D canvas context is required");
    this._canvas = canvas;
    this._context = context;
    this._device = device;
    this._unsubscribe = null;
    this._paintedFrames = 0;
    this._skippedFrames = 0;
    this._paintErrors = 0;
    this._lastRevision = 0;
    this._lastError = null;
  }

  // 구독을 열고 현재 present된 프레임을 즉시 한 번 그린다(붙자마자 검은 화면이 남지 않게).
  start() {
    if (this._unsubscribe) return this;
    this._unsubscribe = this._device.subscribe((frame) => this._paint(frame));
    const current = this._device.readFrame();
    if (current && current.revision) this._paint(current);
    return this;
  }

  stop() {
    if (!this._unsubscribe) return this;
    this._unsubscribe();
    this._unsubscribe = null;
    return this;
  }

  inspect() {
    return Object.freeze({
      attached: !!this._unsubscribe,
      width: this._canvas.width,
      height: this._canvas.height,
      lastRevision: this._lastRevision,
      paintedFrames: this._paintedFrames,
      skippedFrames: this._skippedFrames,
      paintErrors: this._paintErrors,
      lastError: this._lastError,
    });
  }

  _paint(frame) {
    if (!frame || !frame.revision || frame.revision <= this._lastRevision) {
      this._skippedFrames += 1;
      return;
    }
    try {
      const { width, height, pixels } = frame;
      if (!width || !height) throw new WebMachineError("WEB_MACHINE_DISPLAY_PIXELS", "a presented frame has no dimensions");
      if (pixels.length !== width * height * 4) {
        throw new WebMachineError("WEB_MACHINE_DISPLAY_PIXELS", `a presented frame is ${pixels.length} bytes for ${width}x${height}`);
      }
      // 크기의 정본은 프레임이다. canvas 크기를 바꾸면 컨텍스트 상태가 초기화되므로 바뀔 때만 쓴다.
      if (this._canvas.width !== width) this._canvas.width = width;
      if (this._canvas.height !== height) this._canvas.height = height;
      this._context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
      this._lastRevision = frame.revision;
      this._paintedFrames += 1;
    } catch (error) {
      this._paintErrors += 1;
      this._lastError = String(error?.message || error).slice(-160);
    }
  }
}
