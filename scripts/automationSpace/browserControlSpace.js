// browserControlSpace.js - 기존 browser control을 canonical AutomationSpace로 투영한다.
import { controlOperationForTool, controlToolForOperation } from "../controlProtocol/controlOperations.js";

export class BrowserControlSpace {
  constructor(control, { spaceId = "space:native" } = {}) {
    if (!control || typeof control.authorize !== "function" || typeof control.invokeAuthorized !== "function") {
      throw new TypeError("browser control space requires an authorizing control provider");
    }
    this.spaceId = spaceId;
    this.providerKind = "browserControl";
    this.operations = Object.freeze(control.tools.map((tool) => controlOperationForTool(tool.name)));
    this.replayBoundary = "recordOnly";
    this.control = control;
  }

  authorize(operation, input) {
    const tool = controlToolForOperation(operation);
    if (!tool) throw new TypeError(`browser control operation mapping is missing: ${operation}`);
    return this.control.authorize(tool, input);
  }

  execute(operation, input, { signal, authority }) {
    const tool = controlToolForOperation(operation);
    return this.control.invokeAuthorized(tool, input, { signal, authority });
  }

  close() { return this.control.close(); }
}
