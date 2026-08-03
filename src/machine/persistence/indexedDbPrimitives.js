// indexedDbPrimitives.js - Layer 5/platform: IndexedDB의 콜백 API를 promise 계약으로 바꾸는 어댑터.
//
// store에서 나온 이유는 층위다: 이것들은 "브라우저 API가 콜백이라 promise로 감싼다"는 사실만
// 알고, owner/blob/generation/HEAD가 무엇인지는 모른다. 그 둘이 한 파일에 있으면 저장 프로토콜을
// 읽는 사람이 매번 IndexedDB 배관을 먼저 통과해야 한다.
import { WebMachineError } from "../contracts/webMachineError.js";

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new WebMachineError("WEB_MACHINE_STORE_FAILURE", "the IndexedDB request failed"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new WebMachineError("WEB_MACHINE_STORE_FAILURE", "IndexedDB transaction abort"));
    transaction.onerror = () => reject(transaction.error || new WebMachineError("WEB_MACHINE_STORE_FAILURE", "the IndexedDB transaction failed"));
  });
}

function cloneRecord(value) {
  return JSON.parse(JSON.stringify(value));
}

function copyToken(value) {
  return Object.freeze({ groupId: value.groupId, ownerId: value.ownerId, epoch: value.epoch });
}

function validateIdentity(groupId, ownerId) {
  const group = String(groupId || "");
  const owner = String(ownerId || "");
  if (!group) throw new TypeError("a groupId is required");
  if (!owner) throw new TypeError("an ownerId is required");
  return { groupId: group, ownerId: owner };
}


export { requestValue, transactionDone, cloneRecord, copyToken, validateIdentity };
