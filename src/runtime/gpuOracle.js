// gpuOracle.js - WebGPU host provider가 공유하는 closed conformance programs와 결과 oracle.

import { base64FromBytes, sha256Address } from "./contentDigest.js";
import { PyProcError } from "./errors.js";

export const GPU_ORACLE_PROTOCOL = "pyproc.hardwareVisualOracle";
export const GPU_ORACLE_VERSION = 1;

export const VECTOR_ADD_WGSL = `
@group(0) @binding(0) var<storage, read> left: array<f32>;
@group(0) @binding(1) var<storage, read> right: array<f32>;
@group(0) @binding(2) var<storage, read_write> output: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x < arrayLength(&output)) { output[gid.x] = left[gid.x] + right[gid.x]; }
}`;

export const SOLID_RGBA8_WGSL = `
struct Color { value: vec4<f32> };
@group(0) @binding(0) var<uniform> color: Color;
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  let points = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  return vec4<f32>(points[index], 0.0, 1.0);
}
@fragment fn fragmentMain() -> @location(0) vec4<f32> { return color.value; }`;

const LEFT = Object.freeze([1.25, -2.5, 8, 0.125]);
const RIGHT = Object.freeze([3.75, 4.5, -3, 0.875]);
const EXPECTED_VECTOR = Object.freeze([5, 2, 5, 1]);
const PIXEL_WIDTH = 2;
const PIXEL_HEIGHT = 2;
const PIXEL_COLOR = Object.freeze([0.25, 0.5, 0.75, 1]);
const EXPECTED_PIXEL = Object.freeze([64, 128, 191, 255]);

function inputError(message) {
  return new PyProcError("PYPROC_INPUT_INVALID", message);
}

function bytes(value, label) {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  throw inputError(`${label} must be bytes`);
}

function providerInspection(value) {
  if (!value || typeof value !== "object" || value.protocol !== "pyproc.webgpu-host-adapter"
    || value.version !== 1 || !value.adapter || typeof value.adapter !== "object") {
    throw inputError("hardware visual oracle requires a versioned WebGPU provider inspection");
  }
  if (!["hardware", "software", "unknown"].includes(value.adapter.class)) {
    throw inputError("WebGPU provider inspection has an invalid adapter class");
  }
  return Object.freeze({ ...value, adapter: Object.freeze({ ...value.adapter }) });
}

function f32Bytes(values) {
  return new Uint8Array(new Float32Array(values).buffer);
}

function repeatedPixelBytes(width, height, pixel) {
  const result = new Uint8Array(width * height * pixel.length);
  for (let offset = 0; offset < result.length; offset += pixel.length) result.set(pixel, offset);
  return result;
}

function mismatch(stage, message, context) {
  return new PyProcError("PYPROC_GPU_RESULT_MISMATCH", `${stage} oracle mismatch: ${message}`, {
    retryable: false,
    context: Object.freeze({ stage, ...context }),
  });
}

export async function runHardwareVisualOracle(provider, { signal, requireHardware = true } = {}) {
  if (!provider || typeof provider.dispatch !== "function" || typeof provider.inspect !== "function") {
    throw inputError("hardware visual oracle provider requires dispatch and inspect");
  }
  if (typeof requireHardware !== "boolean") throw inputError("requireHardware must be boolean");
  const inspection = providerInspection(await provider.inspect());
  if (requireHardware && inspection.adapter.class !== "hardware") {
    throw new PyProcError("PYPROC_GPU_UNAVAILABLE",
      `hardware visual oracle refuses ${inspection.adapter.class || "unknown"} adapter evidence`, {
        context: Object.freeze({ adapter: inspection.adapter }),
      });
  }
  const left = f32Bytes(LEFT);
  const right = f32Bytes(RIGHT);
  const computeBytes = bytes(await provider.dispatch({ operation: "vectorAdd",
    leftBase64: base64FromBytes(left), rightBase64: base64FromBytes(right) }, { signal }), "compute result");
  if (computeBytes.byteLength !== EXPECTED_VECTOR.length * Float32Array.BYTES_PER_ELEMENT) {
    throw mismatch("compute", "byte length changed", {
      actualByteLength: computeBytes.byteLength,
      expectedByteLength: EXPECTED_VECTOR.length * Float32Array.BYTES_PER_ELEMENT,
    });
  }
  const actualVector = new Float32Array(computeBytes.buffer, computeBytes.byteOffset,
    computeBytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
  let maxAbsError = 0;
  for (let index = 0; index < EXPECTED_VECTOR.length; index += 1) {
    maxAbsError = Math.max(maxAbsError, Math.abs(actualVector[index] - EXPECTED_VECTOR[index]));
  }
  if (maxAbsError !== 0) throw mismatch("compute", "f32 values changed", { maxAbsError });

  const pixelBytes = bytes(await provider.dispatch({ operation: "solidRgba8", width: PIXEL_WIDTH,
    height: PIXEL_HEIGHT, color: [...PIXEL_COLOR] }, { signal }), "pixel result");
  const expectedPixels = repeatedPixelBytes(PIXEL_WIDTH, PIXEL_HEIGHT, EXPECTED_PIXEL);
  if (pixelBytes.byteLength !== expectedPixels.byteLength) {
    throw mismatch("pixel", "byte length changed", {
      actualByteLength: pixelBytes.byteLength, expectedByteLength: expectedPixels.byteLength,
    });
  }
  let maxChannelError = 0;
  for (let index = 0; index < expectedPixels.length; index += 1) {
    maxChannelError = Math.max(maxChannelError, Math.abs(pixelBytes[index] - expectedPixels[index]));
  }
  if (maxChannelError > 1) throw mismatch("pixel", "RGBA8 channels changed", { maxChannelError });

  return Object.freeze({
    protocol: GPU_ORACLE_PROTOCOL,
    version: GPU_ORACLE_VERSION,
    state: "verified",
    adapter: inspection.adapter,
    compute: Object.freeze({ operation: "vectorAdd", elementCount: EXPECTED_VECTOR.length,
      expectedSha256: await sha256Address(f32Bytes(EXPECTED_VECTOR)),
      actualSha256: await sha256Address(computeBytes), maxAbsError, tolerance: 0 }),
    pixel: Object.freeze({ operation: "solidRgba8", format: "rgba8unorm", width: PIXEL_WIDTH,
      height: PIXEL_HEIGHT, expectedSha256: await sha256Address(expectedPixels),
      actualSha256: await sha256Address(pixelBytes), maxChannelError, tolerance: 1 }),
  });
}
