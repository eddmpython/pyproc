// kernelEnvironmentManager.js - Layer 3: locked environments and PEP 723 scripts on a v2 kernel.
import { PyProcError } from "../runtime/errors.js";
import { decodeValueEnvelope } from "../runtime/kernel/valueEnvelope.js";

const PEP723_READER = `
import json as _pyprocEnvironmentJson
import re as _pyprocEnvironmentRe
import tomllib as _pyprocEnvironmentToml
def _pyprocEnvironmentPep723(source):
    pattern = r'(?m)^# /// (?P<type>[a-zA-Z0-9-]+)$\\s(?P<content>(^#(| .*)$\\s)+)^# ///$'
    found = [match for match in _pyprocEnvironmentRe.finditer(pattern, source) if match.group('type') == 'script']
    if len(found) > 1:
        raise ValueError('script block is duplicated')
    if not found:
        return {}
    content = ''.join(line[2:] if line.startswith('# ') else line[1:] for line in found[0].group('content').splitlines(keepends=True))
    return _pyprocEnvironmentToml.loads(content)
_pyprocEnvironmentMetadata = _pyprocEnvironmentPep723(_pyprocEnvironmentScriptSource)
`;

export class KernelEnvironmentManager {
  #kernel;
  #packages;

  constructor(kernel, packageEnvironment) {
    if (!kernel || typeof kernel.execute !== "function" || !packageEnvironment
      || typeof packageEnvironment.install !== "function") {
      throw new PyProcError("PYPROC_INPUT_INVALID", "KernelEnvironmentManager requires a v2 kernel and package environment");
    }
    this.#kernel = kernel;
    this.#packages = packageEnvironment;
  }

  install(request) { return this.#packages.install(request); }

  async runScript(source, options = {}) {
    if (typeof source !== "string") throw new PyProcError("PYPROC_INPUT_INVALID", "Kernel script source must be a string");
    await this.#kernel.setValue({ name: "_pyprocEnvironmentScriptSource", value: source });
    const parsed = await this.#kernel.execute({ code: PEP723_READER });
    if (parsed.state !== "completed") throw new PyProcError("PYPROC_INPUT_INVALID", parsed.error?.message || "PEP 723 metadata is invalid");
    const metadata = await decodeValueEnvelope((await this.#kernel.getValue({ name: "_pyprocEnvironmentMetadata" })).value);
    const requirements = options.requirements || metadata.dependencies || [];
    let environment = null;
    if (requirements.length || options.lock) {
      environment = await this.#packages.install({ requirements, lock: options.lock, offline: options.offline === true });
    }
    const result = await this.#kernel.execute({ code: source });
    return Object.freeze({ result, environment, dependencies: Object.freeze([...requirements]),
      requiresPython: metadata["requires-python"] || null });
  }
}
