// nodeCdpTransport.js - CdpConnection을 BrowserControlPort transport 계약으로 변환한다.
export class NodeCdpTransport {
  constructor(connection, { guard = null } = {}) {
    if (!connection || typeof connection.send !== "function") throw new TypeError("CDP connection is required");
    this._connection = connection;
    this._guard = guard;
    this._sessions = new Map();
    this._children = new Map();
    this._listeners = new Map();
    this._unsubscribe = null;
    this._pendingAttaches = 0;
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

  activateTarget(targetId) {
    return this._connection.send("Target.activateTarget", { targetId: String(targetId) });
  }

  async attach(targetId) {
    this._unsubscribe ||= this._connection.subscribe((event) => this._receiveEvent(event));
    this._pendingAttaches += 1;
    let sessionId;
    try {
      ({ sessionId } = await this._attachTarget(targetId));
      const session = Object.freeze({ id: sessionId, targetId: String(targetId) });
      this._sessions.set(sessionId, session);
      // Same-origin navigation도 opaque locator document epoch을 바꿔야 한다. Page domain은
      // transport 운영 이벤트용으로 내부 활성화하며 raw command permission에는 추가하지 않는다.
      await this._connection.send("Page.enable", {}, session.id);
      if (!this._guard) await this._autoAttach(session.id);
      if (!this._sessions.has(sessionId)) throw new Error("browser target detached during attach");
      return session;
    } catch (error) {
      if (sessionId) {
        await Promise.allSettled([
          this._detachSession(sessionId),
        ]);
        this._removeSession(sessionId);
      }
      throw error;
    } finally {
      this._pendingAttaches -= 1;
      this._releaseSubscription();
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

  async frames(session) {
    const children = this._frameSessions(session);
    return Promise.all(children.map(async (child) => {
      await child.ready;
      const frame = (await this._connection.send("Page.getFrameTree", {}, child.id)).frameTree?.frame;
      if (!frame || frame.id !== child.targetId) throw new Error("browser child frame identity changed");
      return Object.freeze({ id: frame.id, parentId: child.parentId,
        url: frame.url || "", loaderId: frame.loaderId || "" });
    }));
  }

  async describeFrame(session, frameId) {
    const child = this._frameSessions(session).find((item) => item.targetId === frameId);
    if (!child) throw new Error("browser child frame is unavailable");
    await child.ready;
    const frame = (await this._connection.send("Page.getFrameTree", {}, child.id)).frameTree?.frame;
    if (!frame || frame.id !== frameId) throw new Error("browser child frame identity changed");
    return Object.freeze({ id: frame.id, parentId: child.parentId,
      url: frame.url || "", loaderId: frame.loaderId || "" });
  }

  sendFrame(session, frameId, command, options = {}) {
    const child = this._frameSessions(session).find((item) => item.targetId === frameId);
    if (!child) throw new Error("browser child frame is unavailable");
    return this._connection.send(command.method, command.params || {}, child.id, options);
  }

  subscribe(session, listener) {
    const listeners = this._listeners.get(session.id) || new Set();
    listeners.add(listener);
    this._listeners.set(session.id, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this._listeners.delete(session.id);
    };
  }

  inspect() {
    return Object.freeze({ sessions: this._sessions.size, childFrames: this._children.size });
  }

  async detach(session) {
    if (!this._sessions.has(session.id)) return;
    try { await this._detachSession(session.id); }
    finally { this._removeSession(session.id); }
  }

  async close() {
    this._sessions.clear();
    this._children.clear();
    this._listeners.clear();
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._connection.close();
  }

  _releaseSubscription() {
    if (this._sessions.size || this._pendingAttaches) return;
    this._unsubscribe?.();
    this._unsubscribe = null;
  }

  _attachTarget(targetId) {
    return this._connection.send("Target.attachToTarget", { targetId, flatten: true });
  }

  _detachSession(sessionId) {
    return this._connection.send("Target.detachFromTarget", { sessionId });
  }

  _removeSession(sessionId) {
    this._sessions.delete(sessionId);
    this._removeChildren(sessionId);
    this._listeners.delete(sessionId);
    this._releaseSubscription();
  }

  _autoAttach(sessionId) {
    return this._connection.send("Target.setAutoAttach", {
      autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
      filter: [{ type: "iframe", exclude: false }],
    }, sessionId);
  }

  _frameSessions(session) {
    const own = [...this._children.values()].filter((child) => child.rootId === session.id);
    const guarded = this._guard?.frameSessions(session.targetId) || [];
    return [...new Map([...own, ...guarded].map((child) => [child.targetId, child])).values()];
  }

  _removeChildren(parentSessionId) {
    for (const child of [...this._children.values()]) {
      if (child.parentSessionId !== parentSessionId) continue;
      this._removeChildren(child.id);
      this._children.delete(child.id);
    }
  }

  _emit(rootId, event) {
    for (const listener of this._listeners.get(rootId) || []) listener(event);
  }

  _receiveEvent(event) {
    if (event.method === "Target.attachedToTarget") {
      const parent = this._children.get(event.sessionId);
      const rootId = parent?.rootId || (this._sessions.has(event.sessionId) ? event.sessionId : null);
      if (!rootId || event.params?.targetInfo?.type !== "iframe") return;
      const child = { id: event.params.sessionId, targetId: event.params.targetInfo.targetId,
        parentId: parent?.targetId || this._sessions.get(rootId).targetId,
        parentSessionId: event.sessionId, rootId, ready: null };
      this._children.set(child.id, child);
      child.ready = Promise.all([
        this._connection.send("Page.enable", {}, child.id),
        this._autoAttach(child.id),
      ]);
      child.ready.catch(() => {});
      this._emit(rootId, { method: "Transport.frameAttached", params: { frameId: child.targetId }, frameId: child.targetId });
      return;
    }
    if (event.method === "Target.detachedFromTarget") {
      const child = this._children.get(event.params?.sessionId);
      if (child) {
        this._removeChildren(child.id);
        this._children.delete(child.id);
        this._emit(child.rootId, { method: "Transport.frameDetached", params: { frameId: child.targetId }, frameId: child.targetId });
        return;
      }
      if (this._sessions.has(event.params?.sessionId)) {
        this._sessions.delete(event.params.sessionId);
        this._removeChildren(event.params.sessionId);
        try {
          this._emit(event.params.sessionId, { method: "Transport.detached",
            params: { reason: event.params.reason || "target_closed" } });
        } finally { this._removeSession(event.params.sessionId); }
      }
      return;
    }
    const child = this._children.get(event.sessionId);
    if (child) this._emit(child.rootId, { method: event.method, params: event.params, frameId: child.targetId });
    else if (this._sessions.has(event.sessionId)) this._emit(event.sessionId, { method: event.method, params: event.params });
    else {
      for (const root of this._sessions.values()) {
        const guarded = this._guard?.frameSessions(root.targetId).find((item) => item.id === event.sessionId);
        if (guarded) this._emit(root.id, { method: event.method, params: event.params, frameId: guarded.targetId });
      }
    }
  }
}
