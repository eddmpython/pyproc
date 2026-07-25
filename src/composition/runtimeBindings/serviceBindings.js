// serviceBindings.js - Runtime 위에 요청, 서버, URL, 터미널 서비스를 조립한다.
import { AsgiServer } from "../../capabilities/asgiServer.js";
import { SyscallBridge } from "../../capabilities/syscallBridge.js";
import { Terminal } from "../../capabilities/terminal.js";
import { VirtualOrigin } from "../../capabilities/virtualOrigin.js";

export const SERVICE_RUNTIME_BINDINGS = Object.freeze({
  enableSyscallBridge: {
    value(cfg = {}) {
      return new SyscallBridge(this, {
        ...cfg,
        assetIntegrity: cfg.assetIntegrity || this.assetIntegrity,
      });
    },
  },
  enableAsgiServer: {
    value(cfg = {}) {
      return new AsgiServer(this, cfg);
    },
  },
  // 설치된 AsgiServer를 받거나 현재 Runtime에서 새 서버를 만들어 URL 경계에 연결한다.
  enableVirtualOrigin: {
    value(asgi, cfg = {}) {
      return new VirtualOrigin(asgi || this.enableAsgiServer(cfg));
    },
  },
  enableTerminal: {
    value(cfg = {}) {
      return new Terminal(this, cfg);
    },
  },
});
