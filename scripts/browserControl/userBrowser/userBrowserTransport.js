// userBrowserTransport.js - the paired extension's task tabs as a BrowserControlPort transport.
// The connection speaks flat CDP whose sessions are the extension's chrome.debugger tab sessions; target lifecycle is
// the extension's PyprocUserBrowser methods, which reach only the task window's tabs and the tabs they opened.
import { NodeCdpTransport } from "../nodeCdpTransport.js";

export class UserBrowserTransport extends NodeCdpTransport {
  constructor(connection) {
    if (!connection || typeof connection.send !== "function") throw new TypeError("user browser connection is required");
    super(connection);
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

  _attachTarget(targetId) {
    return this._connection.send("PyprocUserBrowser.attachTab", { targetId: String(targetId) });
  }

  _detachSession(sessionId) {
    return this._connection.send("PyprocUserBrowser.detachSession", { sessionId });
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

  // Arms the extension for the one download this tab starts next. `done` settles to where the browser saved it
  // (`{ state: "complete", path, mimeType, url, byteLength }`) or why it did not (`{ state: "interrupted", error }`);
  // `cancel` stops waiting and ends the extension's expectation.
  async armDownload(session, { timeoutMs }) {
    let settle;
    const done = new Promise((resolve) => { settle = resolve; });
    let expectation = null;
    const unsubscribe = this._connection.subscribe((event) => {
      if (event.method === "PyprocUserBrowser.download" && expectation !== null
        && event.params?.expectation === expectation) settle(event.params);
    });
    try {
      ({ expectation } = await this._connection.send("PyprocUserBrowser.expectDownload", { timeoutMs }, session.id));
    } catch (error) {
      unsubscribe();
      throw error;
    }
    return Object.freeze({
      done,
      cancel: async () => {
        unsubscribe();
        try { await this._connection.send("PyprocUserBrowser.forgetDownload", { expectation }); } catch {}
      },
    });
  }

  _receiveEvent(event) {
    if (event.method === "PyprocUserBrowser.detached") {
      return super._receiveEvent({ ...event, method: "Target.detachedFromTarget" });
    }
    super._receiveEvent(event);
  }

  inspect() {
    return Object.freeze({ ...super.inspect(), provider: "userBrowser" });
  }

  async close() {
    // Ending the task is the extension's job too (it ends it when this connection goes), so a pipe already gone is
    // not an error here.
    try { await this._connection.send("PyprocUserBrowser.endTask"); } catch {}
    await super.close();
  }
}
