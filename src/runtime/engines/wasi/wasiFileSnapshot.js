import { Directory, File, OpenDirectory, OpenFile } from "./browserWasiShim.js";
import { PyProcError } from "../../errors.js";

function invalid() {
    return new PyProcError("PYPROC_STATE_CORRUPT", "WASI filesystem checkpoint is invalid");
}

export function createWasiFileBaseline(root, reserved) {
    const baseline = new Map();
    const visit = (node, path) => {
        if (node instanceof Directory) {
            for (const [name, child] of node.contents) {
                if (node !== root || !reserved.has(name)) visit(child, `${path}/${name}`);
            }
        } else if (node.constructor === File) baseline.set(path, node.data.slice());
    };
    visit(root, "");
    return baseline;
}

export function captureWasiFiles(root, fds, reserved, baseline = new Map()) {
    const nodes = [];
    const chunks = [];
    let dataLength = 0;
    const identities = new Map();
    const capture = (node, path = null) => {
        if (identities.has(node)) return identities.get(node);
        const index = nodes.length;
        identities.set(node, index);
        nodes.push(null);
        if (node instanceof Directory) {
            nodes[index] = { kind: "directory", entries: [...node.contents]
                .filter(([name]) => node !== root || !reserved.has(name))
                .map(([name, child]) => [name, capture(child, path === null ? null : `${path}/${name}`)]) };
        } else if (node instanceof File && node.constructor === File) {
            const original = baseline.get(path);
            if (original && original.byteLength === node.data.byteLength
                && original.every((value, offset) => value === node.data[offset])) {
                nodes[index] = { kind: "baseline", path, readonly: node.readonly };
            } else {
                nodes[index] = { kind: "file", offset: dataLength, length: node.data.byteLength, readonly: node.readonly };
                chunks.push(node.data);
                dataLength += node.data.byteLength;
            }
        } else {
            throw new PyProcError("PYPROC_PROCESS_UNAVAILABLE", "An external WASI file cannot be checkpointed");
        }
        return index;
    };
    const rootIndex = capture(root, "");
    const descriptors = fds.slice(4).map((fd) => {
        if (!fd) return null;
        if (fd.constructor === OpenFile) {
            return { kind: "file", node: capture(fd.file), position: String(fd.file_pos) };
        }
        if (fd.constructor === OpenDirectory) return { kind: "directory", node: capture(fd.dir) };
        throw new PyProcError("PYPROC_PROCESS_UNAVAILABLE", "An external WASI descriptor cannot be checkpointed");
    });
    const metadata = new TextEncoder().encode(JSON.stringify({ version: 1, rootIndex, nodes, descriptors }));
    const output = new Uint8Array(4 + metadata.byteLength + dataLength);
    new DataView(output.buffer).setUint32(0, metadata.byteLength, true);
    output.set(metadata, 4);
    let offset = 4 + metadata.byteLength;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return output;
}

export function restoreWasiFiles(bytes, root, fds, reserved, baseline = new Map()) {
    let snapshot;
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 4) throw invalid();
    const metadataLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
    if (metadataLength > bytes.byteLength - 4) throw invalid();
    const data = bytes.subarray(4 + metadataLength);
    try { snapshot = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(4, 4 + metadataLength))); }
    catch (error) { throw new PyProcError("PYPROC_STATE_CORRUPT", "WASI filesystem checkpoint cannot be decoded", { cause: error }); }
    if (snapshot?.version !== 1 || snapshot.rootIndex !== 0 || !Array.isArray(snapshot.nodes)
        || !Array.isArray(snapshot.descriptors) || snapshot.nodes[0]?.kind !== "directory") throw invalid();
    const nodes = snapshot.nodes.map((entry) => {
        if (entry?.kind === "directory" && Array.isArray(entry.entries)) return new Directory([]);
        if (entry?.kind === "baseline" && typeof entry.path === "string"
            && baseline.has(entry.path) && typeof entry.readonly === "boolean") {
            return new File(baseline.get(entry.path).slice(), { readonly: entry.readonly });
        }
        if (entry?.kind === "file" && typeof entry.readonly === "boolean"
            && Number.isSafeInteger(entry.offset) && entry.offset >= 0
            && Number.isSafeInteger(entry.length) && entry.length >= 0
            && entry.offset + entry.length <= data.byteLength) {
            return new File(data.slice(entry.offset, entry.offset + entry.length), { readonly: entry.readonly });
        }
        throw invalid();
    });
    const resolve = (index) => {
        if (!Number.isSafeInteger(index) || index < 0 || !nodes[index]) throw invalid();
        return nodes[index];
    };
    snapshot.nodes.forEach((entry, index) => {
        if (entry.kind !== "directory") return;
        for (const pair of entry.entries) {
            if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string"
                || !pair[0] || /[/\0]/u.test(pair[0]) || [".", ".."].includes(pair[0])
                || nodes[index].contents.has(pair[0]) || (index === 0 && reserved.has(pair[0]))) throw invalid();
            const child = resolve(pair[1]);
            if (child instanceof Directory) {
                if (child === nodes[0] || child.parent) throw invalid();
                child.parent = nodes[index];
            }
            nodes[index].contents.set(pair[0], child);
        }
    });
    for (const node of nodes) {
        if (!(node instanceof Directory)) continue;
        const parents = new Set();
        for (let current = node; current; current = current.parent) {
            if (parents.has(current)) throw invalid();
            parents.add(current);
        }
    }
    const restored = snapshot.descriptors.map((entry) => {
        if (entry === null) return null;
        const node = resolve(entry?.node);
        if (entry.kind === "directory" && node instanceof Directory) return new OpenDirectory(node);
        if (entry.kind === "file" && node instanceof File && typeof entry.position === "string"
            && /^(0|[1-9][0-9]*)$/u.test(entry.position)) {
            const fd = new OpenFile(node);
            fd.file_pos = BigInt(entry.position);
            return fd;
        }
        throw invalid();
    });
    for (const [name, node] of reserved) nodes[0].contents.set(name, node);
    root.contents = nodes[0].contents;
    for (const child of root.contents.values()) if (child instanceof Directory) child.parent = root;
    for (const fd of restored) if (fd?.dir === nodes[0]) fd.dir = root;
    fds.splice(4, fds.length - 4, ...restored);
}
