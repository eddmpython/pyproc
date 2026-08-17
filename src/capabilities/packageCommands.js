// packageCommands.js - Layer 2: IPython %pip와 CPython `python -m pip` 줄 해석.
const MAGIC_LINE = /^\s*%pip\s+install\s+(\S.*)$/u;
const MODULE_PIP_LINE = /^\s*(?:python(?:\d+(?:\.\d+)*)?\s+)?-m\s+pip\s+install\s+(\S.*)$/u;

export const PYTHON_USER_VOCABULARY = Object.freeze({
  runSource: "python -c",
  repl: "code.InteractiveConsole",
  install: Object.freeze(["%pip install", "python -m pip install"]),
  importModule: "import",
  subprocessInstall: "unsupported",
  nativeWheel: "unsupported",
});

export function parsePackageCommandLine(line) {
  if (typeof line !== "string") return null;
  const magic = MAGIC_LINE.exec(line);
  if (magic) return magic[1].trim();
  const modulePip = MODULE_PIP_LINE.exec(line);
  if (modulePip) return modulePip[1].trim();
  return null;
}
