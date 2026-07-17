// memoryRgbaDisplayDevice.js - RGBA8888 region을 working frame에 쓰고 revision 단위로 원자 present한다.
import { WebMachineError } from "../contracts/webMachineError.js";

const BYTES_PER_PIXEL = 4;

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${label}는 양의 정수여야 한다`);
  return value;
}

function copyPixels(value) {
  if (value instanceof Uint8ClampedArray) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8ClampedArray(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8ClampedArray(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  throw new WebMachineError("WEB_MACHINE_DISPLAY_PIXELS", "RGBA frame은 bytes여야 한다");
}

export class MemoryRgbaDisplayDevice {
  constructor({ maxWidth = 4096, maxHeight = 2160, maxFrameBytes = 4096 * 2160 * BYTES_PER_PIXEL } = {}) {
    this.kind = "display";
    this.mode = "rgba-frame";
    this.pixelFormat = "rgba8888";
    this.maxWidth = positiveInteger(maxWidth, "maxWidth");
    this.maxHeight = positiveInteger(maxHeight, "maxHeight");
    this.maxFrameBytes = positiveInteger(maxFrameBytes, "maxFrameBytes");
    this._endpoint = null;
    this._workingWidth = 0;
    this._workingHeight = 0;
    this._presentedWidth = 0;
    this._presentedHeight = 0;
    this._workingPixels = new Uint8ClampedArray(0);
    this._presentedPixels = new Uint8ClampedArray(0);
    this._revision = 0;
    this._regionWrites = 0;
    this._writtenBytes = 0;
    this._presentations = 0;
    this._listenerErrors = 0;
    this._listeners = new Set();
    this._dirty = false;
  }

  connect({ endpointId }) {
    const id = String(endpointId || "");
    if (!id) throw new TypeError("endpointId가 필요하다");
    if (this._endpoint) {
      const code = this._endpoint.id === id ? "WEB_MACHINE_DISPLAY_ENDPOINT_DUPLICATE" : "WEB_MACHINE_DISPLAY_BUSY";
      throw new WebMachineError(code, `display 연결 중: ${this._endpoint.id}`);
    }
    const endpoint = { id, closed: false };
    this._endpoint = endpoint;
    return Object.freeze({
      endpointId: id,
      configure: (size) => this._configure(endpoint, size),
      writeRegion: (region) => this._writeRegion(endpoint, region),
      present: () => this._present(endpoint),
      close: () => this._disconnect(endpoint),
    });
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("display listener는 함수여야 한다");
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  readFrame() {
    return Object.freeze({
      mode: this.mode,
      pixelFormat: this.pixelFormat,
      width: this._presentedWidth,
      height: this._presentedHeight,
      revision: this._revision,
      pixels: this._presentedPixels.slice(),
    });
  }

  inspect() {
    return {
      kind: this.kind,
      mode: this.mode,
      pixelFormat: this.pixelFormat,
      attached: !!this._endpoint,
      endpointId: this._endpoint?.id || null,
      width: this._presentedWidth,
      height: this._presentedHeight,
      revision: this._revision,
      regionWrites: this._regionWrites,
      writtenBytes: this._writtenBytes,
      presentations: this._presentations,
      listenerErrors: this._listenerErrors,
      dirty: this._dirty,
    };
  }

  _configure(endpoint, { width, height } = {}) {
    this._assertEndpoint(endpoint);
    positiveInteger(width, "display width");
    positiveInteger(height, "display height");
    const frameBytes = width * height * BYTES_PER_PIXEL;
    if (!Number.isSafeInteger(frameBytes) || width > this.maxWidth || height > this.maxHeight || frameBytes > this.maxFrameBytes) {
      throw new WebMachineError("WEB_MACHINE_DISPLAY_SIZE", `display 크기 초과: ${width}x${height}/${this.maxWidth}x${this.maxHeight}`);
    }
    if (width === this._workingWidth && height === this._workingHeight) return;
    this._workingWidth = width;
    this._workingHeight = height;
    this._workingPixels = new Uint8ClampedArray(frameBytes);
    this._dirty = true;
  }

  _writeRegion(endpoint, { x, y, width, height, pixels, rowStride = width * BYTES_PER_PIXEL } = {}) {
    this._assertEndpoint(endpoint);
    if (![x, y, width, height, rowStride].every(Number.isInteger) || x < 0 || y < 0 || width <= 0 || height <= 0) {
      throw new WebMachineError("WEB_MACHINE_DISPLAY_REGION", `display region 불일치: ${x},${y}/${width}x${height}`);
    }
    if (x + width > this._workingWidth || y + height > this._workingHeight) {
      throw new WebMachineError("WEB_MACHINE_DISPLAY_RANGE", `display region 범위 초과: ${x},${y}/${width}x${height}`);
    }
    const rowBytes = width * BYTES_PER_PIXEL;
    if (rowStride < rowBytes) throw new WebMachineError("WEB_MACHINE_DISPLAY_STRIDE", `display row stride 부족: ${rowStride}/${rowBytes}`);
    const source = copyPixels(pixels);
    const requiredBytes = (height - 1) * rowStride + rowBytes;
    if (source.byteLength < requiredBytes) {
      throw new WebMachineError("WEB_MACHINE_DISPLAY_PIXELS", `display pixel bytes 부족: ${source.byteLength}/${requiredBytes}`);
    }
    const destinationStride = this._workingWidth * BYTES_PER_PIXEL;
    for (let row = 0; row < height; row += 1) {
      const sourceOffset = row * rowStride;
      const destinationOffset = (y + row) * destinationStride + x * BYTES_PER_PIXEL;
      this._workingPixels.set(source.subarray(sourceOffset, sourceOffset + rowBytes), destinationOffset);
    }
    this._regionWrites += 1;
    this._writtenBytes += rowBytes * height;
    this._dirty = true;
  }

  _present(endpoint) {
    this._assertEndpoint(endpoint);
    if (!this._dirty) return this._revision;
    this._presentedPixels = this._workingPixels.slice();
    this._presentedWidth = this._workingWidth;
    this._presentedHeight = this._workingHeight;
    this._revision += 1;
    this._presentations += 1;
    this._dirty = false;
    for (const listener of this._listeners) {
      try {
        listener(this.readFrame());
      } catch (error) {
        this._listenerErrors += 1;
      }
    }
    return this._revision;
  }

  _disconnect(endpoint) {
    if (endpoint.closed) return;
    endpoint.closed = true;
    if (this._endpoint === endpoint) this._endpoint = null;
  }

  _assertEndpoint(endpoint) {
    if (endpoint.closed || this._endpoint !== endpoint) {
      throw new WebMachineError("WEB_MACHINE_DISPLAY_PORT_CLOSED", `display port 닫힘: ${endpoint.id}`);
    }
  }
}
