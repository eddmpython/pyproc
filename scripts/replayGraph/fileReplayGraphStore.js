// fileReplayGraphStore.js - immutable graph revision, CAS graph HEAD, content-addressed artifact bytes의 durable store.
import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { FileExecutionMemoryStore } from "../executionMemory/fileExecutionMemoryStore.js";
import {
  parseReplayGraphRevision,
  replayGraphError,
  replayGraphRevisionBytes,
  validateReplayGraphRevision,
} from "./replayGraphCanonical.js";

async function writeImmutable(file, bytes) {
  let handle;
  try {
    handle = await open(file, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const current = await readFile(file);
    if (!current.equals(Buffer.from(bytes))) {
      throw replayGraphError("REPLAY_GRAPH_ARTIFACT_CONFLICT", "immutable artifact bytes changed");
    }
  } finally { await handle?.close(); }
}

export class FileReplayGraphStore {
  static async open(rootInput) {
    if (typeof rootInput !== "string" || !isAbsolute(rootInput)) throw new TypeError("ReplayGraph root must be absolute");
    const store = await FileExecutionMemoryStore.open(resolve(rootInput, "replayGraph"));
    await mkdir(store.artifactPath("objects"), { recursive: true });
    return new FileReplayGraphStore(store);
  }

  constructor(store) {
    this.store = store;
    this.root = store.root;
  }

  async publish(graph, expectedRootSha256, artifactBytes = new Map()) {
    const verified = validateReplayGraphRevision(graph);
    for (const artifact of verified.artifacts) {
      const bytes = artifactBytes.get(artifact.sha256);
      if (bytes) await this.putArtifact(artifact.sha256, bytes);
      await this.readArtifact(artifact.sha256, artifact.byteLength);
    }
    await this.store.writeObject(verified.rootSha256, replayGraphRevisionBytes(verified));
    try { await this.store.compareAndSwapHead(`graphHead:${verified.graphId}`, expectedRootSha256, verified.rootSha256); }
    catch (error) {
      if (error?.code === "EXECUTION_MEMORY_HEAD_CONFLICT") {
        throw replayGraphError("REPLAY_GRAPH_HEAD_CONFLICT", `ReplayGraph HEAD changed: ${verified.graphId}`, error.details);
      }
      throw error;
    }
    return verified;
  }

  async readRoot(rootSha256) {
    const bytes = await this.store.readObject(rootSha256);
    if (!bytes) throw replayGraphError("REPLAY_GRAPH_NOT_FOUND", `ReplayGraph revision is unavailable: ${rootSha256}`);
    return parseReplayGraphRevision(bytes, rootSha256);
  }

  async head(graphId) {
    const rootSha256 = await this.store.readHead(`graphHead:${graphId}`);
    return rootSha256 ? this.readRoot(rootSha256) : null;
  }

  async list() {
    const ids = (await this.store.listSessionIds()).filter((id) => id.startsWith("graphHead:graph:"));
    const values = [];
    for (const id of ids) {
      const graph = await this.head(id.slice("graphHead:".length));
      values.push(Object.freeze({ graphId: graph.graphId, rootSha256: graph.rootSha256,
        parentRootSha256: graph.parentRootSha256, nodes: graph.nodes.length, edges: graph.edges.length,
        artifacts: graph.artifacts.length }));
    }
    return Object.freeze(values.sort((left, right) => left.graphId < right.graphId ? -1
      : left.graphId > right.graphId ? 1 : 0));
  }

  async putArtifact(sha256, bytes) {
    const value = Buffer.from(bytes);
    const actual = createHash("sha256").update(value).digest("hex");
    if (actual !== sha256) throw replayGraphError("REPLAY_GRAPH_ARTIFACT_MUTATED", "artifact bytes do not match the digest");
    await writeImmutable(this.store.artifactPath("objects", `${sha256}.bin`), value);
  }

  async readArtifact(sha256, expectedBytes = null) {
    let bytes;
    try { bytes = await readFile(this.store.artifactPath("objects", `${sha256}.bin`)); }
    catch (error) {
      if (error?.code === "ENOENT") throw replayGraphError("REPLAY_GRAPH_ARTIFACT_MISSING", `artifact is unavailable: ${sha256}`);
      throw error;
    }
    if (expectedBytes !== null && bytes.byteLength !== expectedBytes) {
      throw replayGraphError("REPLAY_GRAPH_ARTIFACT_MUTATED", "artifact byte length changed");
    }
    return bytes;
  }
}
