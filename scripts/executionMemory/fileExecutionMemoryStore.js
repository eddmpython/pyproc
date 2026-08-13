// fileExecutionMemoryStore.js - immutable revision objects와 CAS session HEAD의 durable Node store.
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { executionMemoryError } from "./executionMemoryCanonical.js";

function encodedSessionId(sessionId) {
  return Buffer.from(sessionId, "utf8").toString("base64url");
}

async function durableWrite(file, bytes, { exclusive = false } = {}) {
  const handle = await open(file, exclusive ? "wx" : "w", 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
}

async function atomicWrite(file, bytes) {
  const partial = `${file}.partial-${process.pid}-${randomBytes(8).toString("hex")}`;
  try {
    await durableWrite(partial, bytes, { exclusive: true });
    await rename(partial, file);
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined);
    throw error;
  }
}

export class FileExecutionMemoryStore {
  static async open(rootInput) {
    if (typeof rootInput !== "string" || !isAbsolute(rootInput)) {
      throw new TypeError("Execution Memory root must be an absolute path");
    }
    const root = resolve(rootInput);
    await mkdir(join(root, "objects"), { recursive: true });
    await mkdir(join(root, "sessions"), { recursive: true });
    await mkdir(join(root, "locks"), { recursive: true });
    await mkdir(join(root, "artifacts"), { recursive: true });
    await mkdir(join(root, "exports"), { recursive: true });
    return new FileExecutionMemoryStore(root);
  }

  constructor(root) {
    this.root = root;
  }

  artifactPath(...segments) {
    return this.confined("artifacts", ...segments);
  }

  exportPath(relativePath) {
    if (typeof relativePath !== "string" || !relativePath || isAbsolute(relativePath)) {
      throw executionMemoryError("EXECUTION_MEMORY_PATH", "handoff output must be a relative path");
    }
    return this.confined("exports", relativePath);
  }

  async readObject(digest) {
    try { return await readFile(this.confined("objects", `${digest}.json`)); }
    catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async writeObject(digest, bytes) {
    const file = this.confined("objects", `${digest}.json`);
    try { await durableWrite(file, bytes, { exclusive: true }); }
    catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const current = await readFile(file);
      if (!current.equals(Buffer.from(bytes))) {
        throw executionMemoryError("EXECUTION_MEMORY_OBJECT_EXISTS", `immutable revision changed: ${digest}`);
      }
    }
  }

  async readHead(sessionId) {
    try {
      const parsed = JSON.parse(await readFile(this._headPath(sessionId), "utf8"));
      if (!/^[0-9a-f]{64}$/.test(String(parsed?.contentSha256 || ""))) {
        throw executionMemoryError("EXECUTION_MEMORY_HEAD_CORRUPT", `session HEAD is corrupt: ${sessionId}`);
      }
      return parsed.contentSha256;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async compareAndSwapHead(sessionId, expected, next) {
    return this._withLock(sessionId, async () => {
      const current = await this.readHead(sessionId);
      if (current !== expected) {
        throw executionMemoryError("EXECUTION_MEMORY_HEAD_CONFLICT", `session HEAD changed: ${sessionId}`, {
          expected, actual: current,
        });
      }
      await atomicWrite(this._headPath(sessionId), Buffer.from(`${JSON.stringify({ contentSha256: next })}\n`));
    });
  }

  async listSessionIds() {
    const entries = await readdir(this.confined("sessions"), { withFileTypes: true });
    const ids = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".head.json")) continue;
      try { ids.push(Buffer.from(entry.name.slice(0, -10), "base64url").toString("utf8")); }
      catch (error) { throw executionMemoryError("EXECUTION_MEMORY_HEAD_CORRUPT", "session filename is invalid"); }
    }
    return ids.sort();
  }

  async listObjectDigests() {
    const entries = await readdir(this.confined("objects"), { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && /^[0-9a-f]{64}\.json$/.test(entry.name))
      .map((entry) => entry.name.slice(0, -5)).sort();
  }

  confined(...segments) {
    const target = resolve(this.root, ...segments);
    const rel = relative(this.root, target);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
      throw executionMemoryError("EXECUTION_MEMORY_PATH", `path escapes Execution Memory root: ${basename(target)}`);
    }
    return target;
  }

  _headPath(sessionId) {
    return this.confined("sessions", `${encodedSessionId(sessionId)}.head.json`);
  }

  async _withLock(sessionId, operation) {
    const path = this.confined("locks", `${encodedSessionId(sessionId)}.lock`);
    let handle;
    try {
      handle = await open(path, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
      await handle.sync();
    } catch (error) {
      if (error?.code === "EEXIST") {
        let owner = null;
        try { owner = JSON.parse(await readFile(path, "utf8")); }
        catch (readError) {
          if (readError?.code !== "ENOENT") owner = null;
        }
        let alive = true;
        try { process.kill(Number(owner?.pid), 0); } catch (killError) { alive = false; }
        if (!alive) {
          const age = Date.now() - (await stat(path)).mtimeMs;
          if (age > 30000) {
            await rm(path, { force: true });
            return this._withLock(sessionId, operation);
          }
        }
        throw executionMemoryError("EXECUTION_MEMORY_BUSY", `session writer is active: ${sessionId}`);
      }
      throw error;
    }
    try { return await operation(); }
    finally {
      await handle.close();
      await rm(path, { force: true });
    }
  }
}
