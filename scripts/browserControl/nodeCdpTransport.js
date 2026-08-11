// nodeCdpTransport.js - CdpConnection을 BrowserControlPort transport 계약으로 변환한다.
export class NodeCdpTransport {
  constructor(connection) {
    if (!connection || typeof connection.send !== "function") throw new TypeError("CDP connection is required");
    this._connection = connection;
    this._sessions = new Map();
  }

  async listTargets() {
    const { targetInfos = [] } = await this._connection.send("Target.getTargets");
    return targetInfos.map((target) => ({
      id: target.targetId,
      type: target.type,
      url: target.url,
      title: target.title,
      openerId: target.openerId || "",
    }));
  }

  closeTarget(targetId) {
    return this._connection.send("Target.closeTarget", { targetId: String(targetId) });
  }

  async attach(targetId) {
    const { sessionId } = await this._connection.send("Target.attachToTarget", { targetId, flatten: true });
    const session = Object.freeze({ id: sessionId, targetId: String(targetId) });
    try {
      // Same-origin navigation도 opaque locator document epoch을 바꿔야 한다. Page domain은
      // transport 운영 이벤트용으로 내부 활성화하며 raw command permission에는 추가하지 않는다.
      await this._connection.send("Page.enable", {}, session.id);
      this._sessions.set(sessionId, session);
      return session;
    } catch (error) {
      await Promise.allSettled([
        this._connection.send("Target.detachFromTarget", { sessionId }),
      ]);
      throw error;
    }
  }

  async describe(session) {
    // Chromium은 attach된 target을 browser-level Target.getTargets에서 URL/제목 빈 문자열로
    // 강등할 수 있다. 권한 재검사는 session 자체의 frame URL을 읽어야 우회 없이 성립한다.
    const deadline = Date.now() + 10000;
    let frameTreeResult;
    let url = "";
    while (Date.now() < deadline) {
      frameTreeResult = await this._connection.send("Page.getFrameTree", {}, session.id);
      url = frameTreeResult.frameTree?.frame?.url || "";
      if (url) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!url) throw new Error(`CDP target unavailable: ${session.targetId}`);
    return { id: session.targetId, type: "page", url, title: "" };
  }

  send(session, command, options = {}) {
    return this._connection.send(command.method, command.params || {}, session.id, options);
  }

  subscribe(session, listener) {
    return this._connection.subscribe((event) => {
      if (event.sessionId === session.id) listener({ method: event.method, params: event.params });
      if (event.method === "Target.detachedFromTarget" && event.params.sessionId === session.id) {
        listener({ method: "Transport.detached", params: { reason: event.params.reason || "target_closed" } });
      }
    });
  }

  async detach(session) {
    if (!this._sessions.has(session.id)) return;
    try { await this._connection.send("Target.detachFromTarget", { sessionId: session.id }); }
    finally { this._sessions.delete(session.id); }
  }

  async close() {
    this._sessions.clear();
    this._connection.close();
  }
}
