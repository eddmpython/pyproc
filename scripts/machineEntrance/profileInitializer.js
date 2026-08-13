// profileInitializer.js - safe project-local materialization of one fully compiled Machine profile.
import { constants } from "node:fs";
import { access, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { compileMachineProfile } from "./machineProfile.js";

export const MACHINE_PROFILE_DIRECTORY = ".pyproc";
export const MACHINE_PROFILE_FILES = Object.freeze(["manifest.json", "client.json", "README.md"]);

async function exists(path) {
  try { await access(path, constants.F_OK); return true; } catch (error) { return false; }
}

function assertInside(root, target) {
  const fromRoot = relative(root, target);
  if (isAbsolute(fromRoot) || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
    throw new TypeError("Machine profile output must stay inside projectRoot");
  }
}

async function normalizedOutput(projectRoot, outputDir) {
  const root = await realpath(resolve(projectRoot));
  const output = resolve(root, outputDir || MACHINE_PROFILE_DIRECTORY);
  assertInside(root, output);
  let ancestor = output;
  while (!await exists(ancestor)) ancestor = dirname(ancestor);
  assertInside(root, await realpath(ancestor));
  if (await exists(output)) {
    const stat = await lstat(output);
    if (stat.isSymbolicLink()) throw new TypeError("Machine profile output must not be a symbolic link");
    if (!stat.isDirectory()) throw new TypeError("Machine profile output must be a directory");
    const present = await realpath(output);
    assertInside(root, present);
  }
  return Object.freeze({ root, output });
}

function clientSource(manifestPath) {
  return `${JSON.stringify({
    mcpServers: {
      pyproc: {
        command: "npx",
        args: ["--no-install", "pyproc-mcp", "--config", manifestPath],
      },
    },
  }, null, 2)}\n`;
}

function readmeSource({ recipe, manifestPath, output }) {
  return `# pyproc Machine profile

Recipe: \`${recipe}\`

This directory contains a fully expanded authority manifest. The recipe name is descriptive and does not
grant authority at runtime. The manifest remains subject to the strict product validator.

## Next commands

\`\`\`sh
pyproc-control doctor --config "${manifestPath}"
pyproc-control run --config "${manifestPath}" --code "40 + 2"
\`\`\`

Register the MCP snippet in \`${join(output, "client.json")}\` with a client that accepts the common
\`mcpServers\` shape. The initializer does not start a development server, execute repository commands, attach
to a default browser profile, or create credentials.

## Cleanup

Stop the client process, then remove this directory when the profile is no longer needed. Runtime-owned browser
profiles and artifacts are temporary and are removed by normal shutdown.
`;
}

async function packageVersion(packageRoot) {
  const source = await readFile(join(packageRoot, "package.json"), "utf8");
  const version = JSON.parse(source).version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new TypeError("installed package version is invalid");
  }
  return version;
}

function sourcesFor({ profile, output }) {
  const manifestPath = join(output, "manifest.json");
  const manifest = `${JSON.stringify(compileMachineProfile(profile), null, 2)}\n`;
  return new Map([
    [manifestPath, manifest],
    [join(output, "client.json"), clientSource(manifestPath)],
    [join(output, "README.md"), readmeSource({ recipe: profile.recipe, manifestPath, output })],
  ]);
}

async function writeAtomically(files, { overwrite }) {
  const temporary = [];
  const backups = [];
  const committed = [];
  let committedAll = false;
  try {
    for (const [path, source] of files) {
      const temp = `${path}.tmp-${process.pid}-${temporary.length + 1}`;
      await writeFile(temp, source, { flag: "wx", encoding: "utf8" });
      temporary.push(Object.freeze({ path, temp }));
    }
    for (const entry of temporary) {
      if (overwrite && await exists(entry.path)) {
        const backup = `${entry.path}.bak-${process.pid}-${backups.length + 1}`;
        await rename(entry.path, backup);
        backups.push(Object.freeze({ path: entry.path, backup }));
      }
      await rename(entry.temp, entry.path);
      committed.push(entry.path);
    }
    committedAll = true;
  } catch (error) {
    await Promise.all(committed.map((path) => rm(path, { force: true })));
    const rollbackFailures = [];
    for (const entry of backups.toReversed()) {
      try {
        if (await exists(entry.backup)) await rename(entry.backup, entry.path);
      } catch (rollbackError) {
        rollbackFailures.push(rollbackError);
      }
    }
    if (rollbackFailures.length) throw new AggregateError([error, ...rollbackFailures],
      "Machine profile write failed and rollback was incomplete");
    throw error;
  } finally {
    await Promise.all(temporary.map((entry) => rm(entry.temp, { force: true })));
  }
  if (committedAll) await Promise.all(backups.map((entry) => rm(entry.backup, { force: true })));
}

export async function initializeMachineProfile({
  projectRoot = process.cwd(),
  outputDir = MACHINE_PROFILE_DIRECTORY,
  profile,
  overwrite = false,
  dryRun = false,
  packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."),
} = {}) {
  if (typeof overwrite !== "boolean" || typeof dryRun !== "boolean") {
    throw new TypeError("Machine profile overwrite and dryRun must be boolean");
  }
  const paths = await normalizedOutput(projectRoot, outputDir);
  const files = sourcesFor({ profile, output: paths.output });
  const present = [];
  for (const path of files.keys()) if (await exists(path)) present.push(path);
  if (present.length && !overwrite) {
    throw new Error(`Machine profile refuses existing file without --overwrite: ${present[0]}`);
  }
  const version = await packageVersion(packageRoot);
  if (!dryRun) {
    const outputExisted = await exists(paths.output);
    await mkdir(paths.output, { recursive: true });
    try {
      await writeAtomically(files, { overwrite });
    } catch (error) {
      if (!outputExisted) await rm(paths.output, { recursive: true, force: true });
      throw error;
    }
  }
  return Object.freeze({
    ok: true,
    recipe: profile.recipe,
    package: Object.freeze({ name: "pyproc", version }),
    projectRoot: paths.root,
    output: paths.output,
    manifestPath: join(paths.output, "manifest.json"),
    clientPath: join(paths.output, "client.json"),
    readmePath: join(paths.output, "README.md"),
    dryRun,
    overwritten: overwrite && present.length > 0,
    next: Object.freeze({
      doctor: `pyproc-control doctor --config "${join(paths.output, "manifest.json")}"`,
      run: `pyproc-control run --config "${join(paths.output, "manifest.json")}" --code "40 + 2"`,
      mcp: `pyproc-mcp --config "${join(paths.output, "manifest.json")}"`,
    }),
  });
}
