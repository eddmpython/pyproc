// canvasRgbaFrameSource.js - canvas에 실제 반영된 dirty region을 RGBA8888 bytes로 내보낸다.
import { WebMachineError } from "../contracts/webMachineError.js";
export class CanvasRgbaFrameSource {
  constructor({ canvas }) {
    if (!canvas || typeof canvas.getContext !== "function") throw new TypeError("canvas가 필요하다");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context || typeof context.putImageData !== "function" || typeof context.getImageData !== "function") {
      throw new TypeError("2D canvas context가 필요하다");
    }
    this._canvas = canvas;
    this._context = context;
    this._listeners = new Set();
    this._originalPutImageData = context.putImageData;
    this._dirtyRegion = null;
    this._captureScheduled = false;
    this._destroyed = false;
    this._captures = 0;
    this._capturedBytes = 0;
    this._listenerErrors = 0;
    this._captureErrors = 0;
    context.putImageData = (...args) => {
      const result = this._originalPutImageData.apply(context, args);
      this._markDirty(args);
      return result;
    };
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("frame source listener는 함수여야 한다");
    if (this._destroyed) throw new WebMachineError("WEB_MACHINE_DISPLAY_PORT_CLOSED", "frame source가 종료됐다");
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  inspect() {
    return {
      width: this._canvas.width,
      height: this._canvas.height,
      captures: this._captures,
      capturedBytes: this._capturedBytes,
      listeners: this._listeners.size,
      listenerErrors: this._listenerErrors,
      captureErrors: this._captureErrors,
      destroyed: this._destroyed,
    };
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._listeners.clear();
    this._dirtyRegion = null;
    this._context.putImageData = this._originalPutImageData;
  }

  _markDirty(args) {
    if (this._destroyed) return;
    const [imageData, offsetX, offsetY, dirtyX = 0, dirtyY = 0, dirtyWidth = imageData?.width, dirtyHeight = imageData?.height] = args;
    if (!imageData || !Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return;
    const left = Math.max(0, Math.floor(offsetX + dirtyX));
    const top = Math.max(0, Math.floor(offsetY + dirtyY));
    const right = Math.min(this._canvas.width, Math.ceil(offsetX + dirtyX + dirtyWidth));
    const bottom = Math.min(this._canvas.height, Math.ceil(offsetY + dirtyY + dirtyHeight));
    if (left >= right || top >= bottom) return;
    if (this._dirtyRegion) {
      this._dirtyRegion.left = Math.min(this._dirtyRegion.left, left);
      this._dirtyRegion.top = Math.min(this._dirtyRegion.top, top);
      this._dirtyRegion.right = Math.max(this._dirtyRegion.right, right);
      this._dirtyRegion.bottom = Math.max(this._dirtyRegion.bottom, bottom);
    } else {
      this._dirtyRegion = { left, top, right, bottom };
    }
    if (this._captureScheduled) return;
    this._captureScheduled = true;
    queueMicrotask(() => this._flush());
  }

  _flush() {
    this._captureScheduled = false;
    const region = this._dirtyRegion;
    this._dirtyRegion = null;
    if (this._destroyed || !region) return;
    const width = region.right - region.left;
    const height = region.bottom - region.top;
    let imageData;
    try {
      imageData = this._context.getImageData(region.left, region.top, width, height);
    } catch (error) {
      this._captureErrors += 1;
      return;
    }
    this._captures += 1;
    this._capturedBytes += imageData.data.byteLength;
    const update = Object.freeze({
      canvasWidth: this._canvas.width,
      canvasHeight: this._canvas.height,
      x: region.left,
      y: region.top,
      width,
      height,
      pixels: imageData.data,
    });
    for (const listener of this._listeners) {
      try {
        listener(Object.freeze({ ...update, pixels: update.pixels.slice() }));
      } catch (error) {
        this._listenerErrors += 1;
      }
    }
  }
}
