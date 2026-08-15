// kernelReactiveController.js - Layer 0: checkpoint scheduling for the async kernel.
import { PyProcError } from "../errors.js";

export class KernelReactiveController {
  #kernel;
  #nodes = new Map();
  #head = null;

  constructor(kernel) {
    if (!kernel || kernel.runtimeContractVersion !== 2
      || typeof kernel.checkpoint !== "function" || typeof kernel.restore !== "function") {
      throw new PyProcError("PYPROC_INPUT_INVALID", "KernelReactiveController requires KernelRuntimeContract v2");
    }
    this.#kernel = kernel;
  }

  async checkpoint(options = {}) {
    const receipt = await this.#kernel.checkpoint({
      ...options,
      parentCheckpointRef: options.parentCheckpointRef ?? this.#head,
    });
    this.#nodes.set(receipt.checkpointRef, receipt);
    this.#head = receipt.checkpointRef;
    return receipt;
  }

  async restore(checkpointRef) {
    const checkpoint = this.#nodes.get(checkpointRef);
    if (!checkpoint) throw new PyProcError("PYPROC_INPUT_INVALID", "Reactive checkpoint is unknown or pruned");
    const receipt = await this.#kernel.restore({ checkpointRef, checkpoint });
    this.#head = checkpointRef;
    return receipt;
  }

  branch(checkpointRef = this.#head) {
    if (checkpointRef !== null && !this.#nodes.has(checkpointRef)) {
      throw new PyProcError("PYPROC_INPUT_INVALID", "Reactive branch parent is unknown or pruned");
    }
    this.#head = checkpointRef;
    return Object.freeze({ parentCheckpointRef: checkpointRef });
  }

  prune(checkpointRef) {
    if (checkpointRef === this.#head) throw new PyProcError("PYPROC_INPUT_INVALID", "Reactive head cannot be pruned");
    return this.#nodes.delete(checkpointRef);
  }

  inspect() {
    return Object.freeze({ headCheckpointRef: this.#head, checkpointRefs: Object.freeze([...this.#nodes.keys()]) });
  }
}
