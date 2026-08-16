// Web Machine Core v1의 구현 중립 conformance vector.
// 각 expected transcript는 제품 binding과 별도 최소 구현이 모두 만족해야 한다.
export const WEB_MACHINE_CORE_VECTORS = Object.freeze([
  Object.freeze({
    id: "lifecycle-and-inspection",
    scenario: "lifecycle",
    covers: Object.freeze([
      "WM-CORE-001", "WM-CORE-002", "WM-CORE-006", "WM-CORE-007", "WM-CORE-008",
      "WM-CORE-009", "WM-CORE-010", "WM-CORE-011", "WM-CORE-019",
    ]),
    expected: Object.freeze([
      "created", "running", 2, 5, "WEB_MACHINE_INVALID_STATE", "paused",
      "WEB_MACHINE_INVALID_STATE", "running", "stopped",
    ]),
  }),
  Object.freeze({
    id: "adapter-contract-before-boot",
    scenario: "adapterContract",
    covers: Object.freeze(["WM-CORE-003"]),
    expected: Object.freeze(["WEB_MACHINE_ADAPTER_INVALID", 0]),
  }),
  Object.freeze({
    id: "device-permission-before-boot",
    scenario: "devicePermission",
    covers: Object.freeze(["WM-CORE-004"]),
    expected: Object.freeze(["WEB_MACHINE_DEVICE_PERMISSION_DENIED", 0]),
  }),
  Object.freeze({
    id: "serialized-requests",
    scenario: "serializedRequests",
    covers: Object.freeze(["WM-CORE-005"]),
    expected: Object.freeze([1, 1, 2, 2]),
  }),
  Object.freeze({
    id: "portable-image-roundtrip",
    scenario: "portableImage",
    covers: Object.freeze(["WM-CORE-012", "WM-CORE-013", "WM-CORE-014", "WM-CORE-015"]),
    expected: Object.freeze([1, "machine", "fixture", "1", "portable", "paused", 7]),
  }),
  Object.freeze({
    id: "session-image-cold-boundary",
    scenario: "sessionImage",
    covers: Object.freeze(["WM-CORE-016"]),
    expected: Object.freeze(["session", "WEB_MACHINE_SNAPSHOT_SCOPE"]),
  }),
  Object.freeze({
    id: "abort-before-dispatch",
    scenario: "prestartAbort",
    covers: Object.freeze(["WM-CORE-017"]),
    expected: Object.freeze([1, "WEB_MACHINE_OPERATION_ABORTED", true, 1]),
  }),
  Object.freeze({
    id: "abort-after-dispatch",
    scenario: "poststartAbort",
    covers: Object.freeze(["WM-CORE-018"]),
    expected: Object.freeze(["WEB_MACHINE_OUTCOME_UNKNOWN", false, 1, 1]),
  }),
  Object.freeze({
    id: "portable-image-manifest",
    scenario: "imageManifest",
    covers: Object.freeze(["WM-CORE-020", "WM-CORE-021", "WM-CORE-022", "WM-CORE-023"]),
    expected: Object.freeze([
      "a,b", "disk", "blob-a,blob-b,blob-disk", "ECDSA-P256-SHA256",
      "WEB_MACHINE_IMAGE_MANIFEST_INVALID", "WEB_MACHINE_IMAGE_MANIFEST_INVALID",
    ]),
  }),
]);
