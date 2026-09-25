// userBrowserTransport.js - the paired extension's task tabs as a BrowserControlPort transport.
// The connection speaks flat CDP whose sessions are the extension's chrome.debugger tab sessions; target lifecycle is
// the extension's PyprocUserBrowser methods, which reach only the task window's tabs and the tabs they opened.
export class UserBrowserTransport {
  constructor(connection) {
    if (!connection || typeof connection.send !== "function") throw new TypeError("user browser connection is required");
    this._connection = connection;
    this._sessions = new Map();
  }

  async listTargets() {
    const { tabs = [] } = await this._connection.send("PyprocUserBrowser.listTabs");
    return tabs.map((tab) => ({ id: String(tab.targetId), type: "page", url: String(tab.url || ""),
      title: String(tab.title || ""), openerId: String(tab.openerId || "") }));
  }

  closeTarget(targetId) {
    return this._connection.send("PyprocUserBrowser.closeTab", { targetId: String(targetId) });
  }

  activateTarget(targetId) {
    return this._connection.send("PyprocUserBrowser.activateTab", { targetId: String(targetId) });
  }

  async attach(targetId) {
    const { sessionId } = await this._connection.send("PyprocUserBrowser.attachTab", { targetId: String(targetId) });
    const session = Object.freeze({ id: sessionId, targetId: String(targetId) });
    try {
      // Same-origin navigation must replace the opaque locator epoch, as on a native CDP session.
      await this._connection.send("Page.enable", {}, session.id);
      this._sessions.set(sessionId, session);
      return session;
    } catch (error) {
      await Promise.allSettled([this._connection.send("PyprocUserBrowser.detachSession", { sessionId })]);
      throw error;
    }
  }

  async describe(session) {
    // Authority is re-checked against the session's own frame URL, never a listed one.
    const deadline = Date.now() + 10000;
    let url = "";
    while (Date.now() < deadline) {
      const { frameTree } = await this._connection.send("Page.getFrameTree", {}, session.id);
      url = frameTree?.frame?.url || "";
      if (url) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!url) throw new Error(`user browser tab unavailable: ${session.targetId}`);
    return { id: session.targetId, type: "page", url, title: "" };
  }

  send(session, command, options = {}) {
    return this._connection.send(command.method, command.params || {}, session.id, options);
  }

  subscribe(session, listener) {
    return this._connection.subscribe((event) => {
      if (event.method === "PyprocUserBrowser.detached") {
        if (event.params.sessionId !== session.id) return;
        this._sessions.delete(session.id);
        listener({ method: "Transport.detached", params: { reason: event.params.reason || "target_closed" } });
        return;
      }
      if (event.sessionId === session.id) listener({ method: event.method, params: event.params });
    });
  }

  inspect() {
    return Object.freeze({ provider: "userBrowser", sessions: this._sessions.size });
  }

  async detach(session) {
    if (!this._sessions.has(session.id)) return;
    try { await this._connection.send("PyprocUserBrowser.detachSession", { sessionId: session.id }); }
    finally { this._sessions.delete(session.id); }
  }

  async close() {
    this._sessions.clear();
    // Ending the task is the extension's job too (it ends it when this connection goes), so a pipe already gone is
    // not an error here.
    try { await this._connection.send("PyprocUserBrowser.endTask"); } catch {}
    this._connection.close();
  }
}
