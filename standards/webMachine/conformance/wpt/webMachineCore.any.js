// META: title=Web Machine Core v1 conformance vectors
// META: timeout=long

// The embedding implementation sets globalThis.webMachineConformanceFactory before this file runs.
// Each vector becomes one atomic testharness subtest.
setup({ explicit_done: true });

(async () => {
  const { WEB_MACHINE_CORE_VECTORS } = await import("../../vectors/coreVectors.js");
  const { runVector } = await import("../runVectors.js");
  test(() => {
    assert_true(!!globalThis.webMachineConformanceFactory, "implementation factory must be installed");
  }, "Web Machine Core v1 implementation factory is installed");
  for (const vector of WEB_MACHINE_CORE_VECTORS) {
    promise_test(async () => {
      const result = await runVector(globalThis.webMachineConformanceFactory, vector);
      assert_array_equals(result.transcript, vector.expected);
    }, `Web Machine Core v1: ${vector.id}`);
  }
  done();
})().catch((error) => {
  test(() => { throw error; }, "Web Machine Core v1 module setup");
  done();
});
