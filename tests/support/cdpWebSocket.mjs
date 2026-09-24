// cdpWebSocket.mjs - 시험이 제품 밖에서 같은 브라우저를 관찰할 때만 쓰는 DevTools WebSocket 연결.
// 제품 broker는 --remote-debugging-pipe로만 잇는다. 시험이 브라우저를 직접 띄울 때 --remote-debugging-port=0을
// 더하면 이 helper로 두 번째 CDP 연결을 열어 새로고침이나 확장 동작을 제품 밖에서 일으키거나 본다.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CdpConnection } from "../../scripts/browserControl/cdpConnection.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function readDevToolsEndpoint(profileDir, { timeoutMs = 30000 } = {}) {
  const path = join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const [port, browserPath] = (await readFile(path, "utf8")).trim().split(/\r?\n/);
      if (Number(port) > 0 && browserPath?.startsWith("/devtools/browser/")) return `ws://127.0.0.1:${port}${browserPath}`;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await delay(50);
  }
  throw new Error(`DevToolsActivePort unavailable in ${profileDir}`);
}

export async function connectCdpWebSocket(url, { timeoutMs = 10000 } = {}) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP WebSocket connect timeout")), timeoutMs);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP WebSocket connect failed")); }, { once: true });
  });
  return new CdpConnection({
    listen(onMessage, onClose) {
      socket.addEventListener("message", (event) => onMessage(String(event.data)));
      socket.addEventListener("close", () => onClose(new Error("CDP WebSocket closed")));
      socket.addEventListener("error", () => onClose(new Error("CDP WebSocket error")));
    },
    send(text) { socket.send(text); },
    close() { socket.close(); },
  }, { timeoutMs });
}
