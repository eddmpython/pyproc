import { createWebMachineKeyPair } from "/src/machine/index.js";

const databaseName = "webComputerIdentityV1";
const storeName = "identity";
const identityKey = "deviceSigningKey";
const keyAlgorithm = Object.freeze({ name: "ECDSA", namedCurve: "P-256" });

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
}

async function openDatabase() {
  const request = indexedDB.open(databaseName, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(storeName);
  return requestResult(request);
}

async function importPair(record) {
  if (!record?.publicKey || !record?.privateKey) return null;
  const [publicKey, privateKey] = await Promise.all([
    crypto.subtle.importKey("jwk", record.publicKey, keyAlgorithm, true, ["verify"]),
    crypto.subtle.importKey("jwk", record.privateKey, keyAlgorithm, true, ["sign"]),
  ]);
  return { publicKey, privateKey };
}

export async function getOrCreateSigningIdentity() {
  const database = await openDatabase();
  try {
    const read = database.transaction(storeName, "readonly");
    const existing = await requestResult(read.objectStore(storeName).get(identityKey));
    await transactionDone(read);
    const imported = await importPair(existing);
    if (imported) return imported;

    const pair = await createWebMachineKeyPair(crypto);
    const [publicKey, privateKey] = await Promise.all([
      crypto.subtle.exportKey("jwk", pair.publicKey),
      crypto.subtle.exportKey("jwk", pair.privateKey),
    ]);
    const write = database.transaction(storeName, "readwrite");
    write.objectStore(storeName).put({ publicKey, privateKey }, identityKey);
    await transactionDone(write);
    return pair;
  } finally {
    database.close();
  }
}
