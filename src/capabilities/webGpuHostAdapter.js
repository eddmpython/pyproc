// webGpuHostAdapter.js - Layer 2: closed WebGPU operations for the GPU hostcall ABI.

import { bytesFromBase64 } from "../runtime/contentDigest.js";
import { PyProcError } from "../runtime/errors.js";
import { SOLID_RGBA8_WGSL, VECTOR_ADD_WGSL } from "../runtime/gpuOracle.js";

const MAX_VECTOR_ELEMENTS = 1 << 20;
const MAX_PIXEL_BYTES = 16 * 1024 * 1024;
const SOFTWARE_ADAPTER = /swiftshader|llvmpipe|lavapipe|software|warp|microsoft basic/i;
const HARDWARE_VENDOR = /nvidia|amd|advanced micro devices|intel|apple|qualcomm|arm|10de|1002|8086/i;
const OPTION_KEYS = new Set(["gpu", "powerPreference", "forceFallbackAdapter", "requireHardware"]);

function inputError(message) {
  return new PyProcError("PYPROC_INPUT_INVALID", message);
}

function closedObject(value, label, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) throw inputError(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!keys.has(key)) throw inputError(`${label} does not accept ${key}`);
  return value;
}

function adapterInfo(raw = {}) {
  const info = Object.freeze({
    vendor: String(raw.vendor || ""),
    architecture: String(raw.architecture || ""),
    device: String(raw.device || ""),
    description: String(raw.description || ""),
    isFallbackAdapter: raw.isFallbackAdapter === true ? true : raw.isFallbackAdapter === false ? false : null,
  });
  const text = Object.values(info).join(" ");
  const software = info.isFallbackAdapter === true || SOFTWARE_ADAPTER.test(text);
  const hardware = !software && (info.isFallbackAdapter === false || HARDWARE_VENDOR.test(text));
  return Object.freeze({ ...info, class: hardware ? "hardware" : software ? "software" : "unknown" });
}

async function readAdapterInfo(adapter) {
  if (adapter?.info) return adapterInfo(adapter.info);
  if (typeof adapter?.requestAdapterInfo === "function") return adapterInfo(await adapter.requestAdapterInfo());
  return adapterInfo();
}

function f32Input(value, label) {
  if (typeof value !== "string" || !value) throw inputError(`${label} must be non-empty base64 text`);
  const bytes = bytesFromBase64(value);
  if (!bytes.byteLength || bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw inputError(`${label} must contain one or more aligned f32 values`);
  }
  const elements = bytes.byteLength / Float32Array.BYTES_PER_ELEMENT;
  if (elements > MAX_VECTOR_ELEMENTS) throw inputError(`${label} exceeds the vector element limit`);
  return bytes;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw inputError(`${label} must be a positive integer`);
  return value;
}

function colorValue(value) {
  if (!Array.isArray(value) || value.length !== 4
    || value.some((entry) => !Number.isFinite(entry) || entry < 0 || entry > 1)) {
    throw inputError("solidRgba8 color must contain four finite values from 0 to 1");
  }
  return new Float32Array(value);
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw new PyProcError("PYPROC_GPU_UNAVAILABLE",
    "WebGPU dispatch was cancelled before submission", { cause: signal.reason });
}

function providerError(message, cause, context = undefined) {
  if (cause instanceof PyProcError) return cause;
  return new PyProcError("PYPROC_GPU_UNAVAILABLE", message, { cause, context });
}

async function validated(device, label, operation) {
  if (typeof device.pushErrorScope !== "function" || typeof device.popErrorScope !== "function") {
    return operation();
  }
  device.pushErrorScope("validation");
  let value;
  let thrown = null;
  try { value = await operation(); }
  catch (error) { thrown = error; }
  const scoped = await device.popErrorScope();
  if (thrown) throw providerError(`${label} failed`, thrown);
  if (scoped) throw providerError(`${label} failed validation`, scoped, { validationMessage: scoped.message });
  return value;
}

class WebGpuHostAdapter {
  constructor(device, inspection) {
    this.device = device;
    this.inspection = inspection;
    this.closed = false;
    this.lost = null;
    this.vectorPipeline = null;
    this.pixelPipeline = null;
    if (device.lost && typeof device.lost.then === "function") {
      device.lost.then((info) => { this.lost = Object.freeze({ reason: info.reason, message: info.message }); });
    }
  }

  inspect() {
    return Object.freeze({ ...this.inspection,
      state: this.closed ? "closed" : this.lost ? "lost" : "ready",
      ...(this.lost ? { loss: this.lost } : {}),
    });
  }

  async dispatch(input, { signal } = {}) {
    closedObject(input, "WebGPU dispatch", input?.operation === "vectorAdd"
      ? new Set(["operation", "leftBase64", "rightBase64"])
      : input?.operation === "solidRgba8"
        ? new Set(["operation", "width", "height", "color"])
        : new Set(["operation"]));
    if (this.closed || this.lost) throw new PyProcError("PYPROC_GPU_UNAVAILABLE",
      this.closed ? "WebGPU adapter is closed" : "WebGPU device was lost", {
        context: this.lost ? { loss: this.lost } : undefined,
      });
    abortIfNeeded(signal);
    if (input.operation === "vectorAdd") return this._vectorAdd(input, signal);
    if (input.operation === "solidRgba8") return this._solidRgba8(input, signal);
    throw inputError("WebGPU operation must be vectorAdd or solidRgba8");
  }

  async _vectorAdd(input, signal) {
    const left = f32Input(input.leftBase64, "leftBase64");
    const right = f32Input(input.rightBase64, "rightBase64");
    if (left.byteLength !== right.byteLength) throw inputError("vectorAdd inputs must have equal f32 byte lengths");
    const usage = globalThis.GPUBufferUsage;
    const mapMode = globalThis.GPUMapMode;
    if (!usage || !mapMode) throw new PyProcError("PYPROC_GPU_UNAVAILABLE", "WebGPU buffer constants are unavailable");
    const inputBuffers = [left, right].map((bytes) => {
      const buffer = this.device.createBuffer({ size: bytes.byteLength,
        usage: usage.STORAGE | usage.COPY_DST });
      this.device.queue.writeBuffer(buffer, 0, bytes);
      return buffer;
    });
    const output = this.device.createBuffer({ size: left.byteLength,
      usage: usage.STORAGE | usage.COPY_SRC });
    const readback = this.device.createBuffer({ size: left.byteLength,
      usage: usage.COPY_DST | usage.MAP_READ });
    try {
      const pipeline = await this._vectorPipeline();
      const bindGroup = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: inputBuffers[0] } },
        { binding: 1, resource: { buffer: inputBuffers[1] } },
        { binding: 2, resource: { buffer: output } },
      ] });
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil((left.byteLength / Float32Array.BYTES_PER_ELEMENT) / 64));
      pass.end();
      encoder.copyBufferToBuffer(output, 0, readback, 0, left.byteLength);
      abortIfNeeded(signal);
      this.device.queue.submit([encoder.finish()]);
      await readback.mapAsync(mapMode.READ);
      return new Uint8Array(readback.getMappedRange().slice(0));
    } catch (error) {
      throw providerError("WebGPU vectorAdd failed", error);
    } finally {
      if (readback.mapState === "mapped") readback.unmap();
      for (const buffer of [...inputBuffers, output, readback]) buffer.destroy();
    }
  }

  async _solidRgba8(input, signal) {
    const width = positiveInteger(input.width, "solidRgba8 width");
    const height = positiveInteger(input.height, "solidRgba8 height");
    const byteLength = width * height * 4;
    if (!Number.isSafeInteger(byteLength) || byteLength > MAX_PIXEL_BYTES) {
      throw inputError("solidRgba8 output exceeds the pixel byte limit");
    }
    const color = colorValue(input.color);
    const usage = globalThis.GPUBufferUsage;
    const textureUsage = globalThis.GPUTextureUsage;
    const mapMode = globalThis.GPUMapMode;
    if (!usage || !textureUsage || !mapMode) {
      throw new PyProcError("PYPROC_GPU_UNAVAILABLE", "WebGPU texture constants are unavailable");
    }
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    if (!Number.isSafeInteger(bytesPerRow * height) || bytesPerRow * height > MAX_PIXEL_BYTES) {
      throw inputError("solidRgba8 padded readback exceeds the pixel byte limit");
    }
    const texture = this.device.createTexture({ size: { width, height }, format: "rgba8unorm",
      usage: textureUsage.RENDER_ATTACHMENT | textureUsage.COPY_SRC });
    const colorBuffer = this.device.createBuffer({ size: 16, usage: usage.UNIFORM | usage.COPY_DST });
    this.device.queue.writeBuffer(colorBuffer, 0, color);
    const readback = this.device.createBuffer({ size: bytesPerRow * height,
      usage: usage.COPY_DST | usage.MAP_READ });
    try {
      const pipeline = await this._pixelPipeline();
      const bindGroup = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: colorBuffer } }] });
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(),
        clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "store" }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      encoder.copyTextureToBuffer({ texture }, { buffer: readback, bytesPerRow, rowsPerImage: height },
        { width, height });
      abortIfNeeded(signal);
      this.device.queue.submit([encoder.finish()]);
      await readback.mapAsync(mapMode.READ);
      const mapped = new Uint8Array(readback.getMappedRange());
      const compact = new Uint8Array(byteLength);
      for (let row = 0; row < height; row += 1) {
        compact.set(mapped.subarray(row * bytesPerRow, row * bytesPerRow + width * 4), row * width * 4);
      }
      return compact;
    } catch (error) {
      throw providerError("WebGPU solidRgba8 failed", error);
    } finally {
      if (readback.mapState === "mapped") readback.unmap();
      readback.destroy();
      colorBuffer.destroy();
      texture.destroy();
    }
  }

  _vectorPipeline() {
    if (!this.vectorPipeline) this.vectorPipeline = validated(this.device, "WebGPU vectorAdd pipeline", async () => {
      const module = this.device.createShaderModule({ code: VECTOR_ADD_WGSL });
      return this.device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "main" } });
    });
    return this.vectorPipeline;
  }

  _pixelPipeline() {
    if (!this.pixelPipeline) this.pixelPipeline = validated(this.device, "WebGPU pixel pipeline", async () => {
      const module = this.device.createShaderModule({ code: SOLID_RGBA8_WGSL });
      return this.device.createRenderPipelineAsync({ layout: "auto",
        vertex: { module, entryPoint: "vertexMain" },
        fragment: { module, entryPoint: "fragmentMain", targets: [{ format: "rgba8unorm" }] },
        primitive: { topology: "triangle-list" } });
    });
    return this.pixelPipeline;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.device.destroy();
  }
}

export async function createWebGpuHostAdapter(options = {}) {
  const value = closedObject(options, "WebGPU adapter options", OPTION_KEYS);
  const gpu = value.gpu === undefined ? globalThis.navigator?.gpu : value.gpu;
  if (!gpu || typeof gpu.requestAdapter !== "function") {
    throw new PyProcError("PYPROC_GPU_UNAVAILABLE", "WebGPU is unavailable because navigator.gpu is absent");
  }
  const powerPreference = value.powerPreference === undefined ? "high-performance" : value.powerPreference;
  if (!["high-performance", "low-power"].includes(powerPreference)) {
    throw inputError("powerPreference must be high-performance or low-power");
  }
  if (value.forceFallbackAdapter !== undefined && typeof value.forceFallbackAdapter !== "boolean") {
    throw inputError("forceFallbackAdapter must be boolean");
  }
  if (value.requireHardware !== undefined && typeof value.requireHardware !== "boolean") {
    throw inputError("requireHardware must be boolean");
  }
  if (value.requireHardware === true && value.forceFallbackAdapter === true) {
    throw inputError("requireHardware cannot be combined with forceFallbackAdapter");
  }
  let adapter;
  try { adapter = await gpu.requestAdapter({ powerPreference,
    ...(value.forceFallbackAdapter === undefined ? {} : { forceFallbackAdapter: value.forceFallbackAdapter }) }); }
  catch (error) { throw providerError("WebGPU adapter request failed", error); }
  if (!adapter) throw new PyProcError("PYPROC_GPU_UNAVAILABLE", "WebGPU requestAdapter returned no adapter");
  const info = await readAdapterInfo(adapter);
  if (value.requireHardware === true && info.class !== "hardware") {
    throw new PyProcError("PYPROC_GPU_UNAVAILABLE", `WebGPU hardware adapter required, got ${info.class}`, {
      context: { adapter: info },
    });
  }
  let device;
  try { device = await adapter.requestDevice(); }
  catch (error) { throw providerError("WebGPU device request failed", error, { adapter: info }); }
  return new WebGpuHostAdapter(device, Object.freeze({ protocol: "pyproc.webgpu-host-adapter", version: 1,
    adapter: info, operations: Object.freeze(["solidRgba8", "vectorAdd"]),
    limits: Object.freeze({ maxVectorElements: MAX_VECTOR_ELEMENTS, maxPixelBytes: MAX_PIXEL_BYTES }) }));
}
