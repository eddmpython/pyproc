// residentGitAndPythonToolBridgeProbe.mjs - RED-first graduation probe for resident Git and the Python argv bridge.
process.env.PYPROC_EXPECT_TOOL_BRIDGE = "1";
await import("../../support/wasmToolLayerProduct.mjs");
