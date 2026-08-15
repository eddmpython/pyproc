import assert from "node:assert/strict";

import { createWebGpuHostAdapter } from "../../src/capabilities/webGpuHostAdapter.js";
import { base64FromBytes, bytesFromBase64 } from "../../src/runtime/contentDigest.js";
import { runHardwareVisualOracle } from "../../src/runtime/gpuOracle.js";

function f32Bytes(values) {
  return new Uint8Array(new Float32Array(values).buffer);
}

function provider({ adapterClass = "hardware", wrongPixel = false } = {}) {
  let dispatches = 0;
  return {
    inspect() {
      return { protocol: "pyproc.webgpu-host-adapter", version: 1, state: "ready",
        adapter: { vendor: "contract", architecture: "fixture", device: "", description: "",
          isFallbackAdapter: adapterClass === "software", class: adapterClass },
        operations: ["solidRgba8", "vectorAdd"], limits: { maxVectorElements: 1024, maxPixelBytes: 1024 } };
    },
    async dispatch(input) {
      dispatches += 1;
      if (input.operation === "vectorAdd") {
        const leftBytes = bytesFromBase64(input.leftBase64);
        const rightBytes = bytesFromBase64(input.rightBase64);
        const left = new Float32Array(leftBytes.buffer, leftBytes.byteOffset, leftBytes.byteLength / 4);
        const right = new Float32Array(rightBytes.buffer, rightBytes.byteOffset, rightBytes.byteLength / 4);
        return f32Bytes(Array.from(left, (value, index) => value + right[index]));
      }
      const bytes = new Uint8Array(input.width * input.height * 4);
      const pixel = [64 + (wrongPixel ? 3 : 0), 128, 191, 255];
      for (let offset = 0; offset < bytes.length; offset += 4) bytes.set(pixel, offset);
      return bytes;
    },
    dispatchCount: () => dispatches,
  };
}

export async function assertHardwareVisualOracleContract() {
  const valid = provider();
  const receipt = await runHardwareVisualOracle(valid);
  assert.equal(receipt.protocol, "pyproc.hardwareVisualOracle");
  assert.equal(receipt.version, 1);
  assert.equal(receipt.state, "verified");
  assert.equal(receipt.adapter.class, "hardware");
  assert.equal(receipt.compute.maxAbsError, 0);
  assert.equal(receipt.compute.expectedSha256, receipt.compute.actualSha256);
  assert.equal(receipt.pixel.maxChannelError, 0);
  assert.equal(receipt.pixel.expectedSha256, receipt.pixel.actualSha256);
  assert.equal(valid.dispatchCount(), 2);

  await assert.rejects(() => runHardwareVisualOracle(provider({ wrongPixel: true })), (error) =>
    error.code === "PYPROC_GPU_RESULT_MISMATCH" && error.context?.stage === "pixel");
  const software = provider({ adapterClass: "software" });
  await assert.rejects(() => runHardwareVisualOracle(software), (error) =>
    error.code === "PYPROC_GPU_UNAVAILABLE");
  assert.equal(software.dispatchCount(), 0);

  let destroyed = 0;
  const fakeDevice = { destroy() { destroyed += 1; }, lost: new Promise(() => {}) };
  const adapter = await createWebGpuHostAdapter({ requireHardware: true, gpu: {
    async requestAdapter() {
      return { info: { vendor: "amd", architecture: "rdna-3", isFallbackAdapter: false },
        async requestDevice() { return fakeDevice; } };
    },
  } });
  assert.equal(adapter.inspect().adapter.class, "hardware");
  await assert.rejects(() => adapter.dispatch({ operation: "unknown" }), (error) =>
    error.code === "PYPROC_INPUT_INVALID");
  adapter.close();
  adapter.close();
  assert.equal(destroyed, 1);
  assert.equal(adapter.inspect().state, "closed");

  await assert.rejects(() => createWebGpuHostAdapter({ unknown: true }), (error) =>
    error.code === "PYPROC_INPUT_INVALID");
  await assert.rejects(() => createWebGpuHostAdapter({ requireHardware: true, forceFallbackAdapter: true,
    gpu: { requestAdapter() { return null; } } }), (error) => error.code === "PYPROC_INPUT_INVALID");

  const encoded = base64FromBytes(f32Bytes([1, 2]));
  assert.equal(new Float32Array(bytesFromBase64(encoded).buffer)[1], 2);
}
