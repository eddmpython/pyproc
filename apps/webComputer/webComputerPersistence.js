import {
  WEB_COMPUTER_CAPABILITIES,
  WEB_COMPUTER_GROUP_ID,
} from "./machineConfig.js";
import { getOrCreateSigningIdentity } from "./identityStore.js";

// 저장 알고리즘은 createWebComputer가 소유한다. 제품은 어느 workspace/store/lock을 쓰고
// 무엇을 서명·허용하는지만 조립한다.
export function createWebComputerDurabilityPolicy({ store, ownerId, onOwnerChanged }) {
  if (!store) throw new TypeError("Web Computer store is required");
  return Object.freeze({
    groupId: WEB_COMPUTER_GROUP_ID,
    store,
    lockManager: navigator.locks,
    ownerId,
    nowFactory: () => Date.now(),
    getSigningKeyPair: getOrCreateSigningIdentity,
    requiredCapabilities: Object.freeze({
      pythonOs: Object.freeze(["pyproc"]),
      linuxOs: Object.freeze(["x86-linux"]),
    }),
    availableCapabilities: WEB_COMPUTER_CAPABILITIES,
    onOwnerChanged,
  });
}
