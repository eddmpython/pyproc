// wasmThreadCapability.mjs - build가 만든 WASM memory와 thread spawn import를 직접 판독한다.

function bytesOf(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new TypeError("WASM bytes must be an ArrayBuffer or Uint8Array");
}

function reader(input) {
  const bytes = bytesOf(input);
  let offset = 0;
  const octet = () => {
    if (offset >= bytes.byteLength) throw new Error("WASM section is truncated");
    return bytes[offset++];
  };
  const uleb = () => {
    let value = 0; let shift = 0; let byte = 0;
    do {
      byte = octet();
      value += (byte & 0x7f) * 2 ** shift;
      shift += 7;
      if (shift > 53) throw new Error("WASM integer exceeds the safe range");
    } while (byte & 0x80);
    if (!Number.isSafeInteger(value)) throw new Error("WASM integer exceeds the safe range");
    return value;
  };
  const text = () => {
    const length = uleb();
    if (offset + length > bytes.byteLength) throw new Error("WASM string is truncated");
    const value = new TextDecoder().decode(bytes.subarray(offset, offset + length));
    offset += length;
    return value;
  };
  return { bytes, octet, uleb, text, get offset() { return offset; }, set offset(value) { offset = value; } };
}

function limits(source) {
  const flags = source.uleb();
  const minimumPages = source.uleb();
  const maximumPages = flags & 1 ? source.uleb() : null;
  return Object.freeze({ flags, minimumPages, maximumPages,
    shared: Boolean(flags & 2), memory64: Boolean(flags & 4) });
}

function skipImportDescriptor(source, kind) {
  if (kind === 0) source.uleb();
  else if (kind === 1) { source.octet(); limits(source); }
  else if (kind === 3) { source.octet(); source.octet(); }
  else if (kind === 4) { source.octet(); source.uleb(); }
  else throw new Error(`unsupported WASM import kind: ${kind}`);
}

export function inspectWasmThreadCapability(input) {
  const source = reader(input);
  if (source.bytes.byteLength < 8
    || source.octet() !== 0x00 || source.octet() !== 0x61 || source.octet() !== 0x73 || source.octet() !== 0x6d
    || source.octet() !== 0x01 || source.octet() !== 0x00 || source.octet() !== 0x00 || source.octet() !== 0x00) {
    throw new Error("WASM header is invalid");
  }
  const memories = [];
  const imports = [];
  while (source.offset < source.bytes.byteLength) {
    const section = source.octet();
    const size = source.uleb();
    const end = source.offset + size;
    if (end > source.bytes.byteLength) throw new Error("WASM section exceeds the input");
    const parsedSection = section === 2 || section === 5;
    if (section === 2) {
      const count = source.uleb();
      for (let index = 0; index < count; index += 1) {
        const module = source.text();
        const name = source.text();
        const kind = source.octet();
        imports.push(Object.freeze({ module, name, kind }));
        if (kind === 2) memories.push(Object.freeze({ source:"imported", module, name, ...limits(source) }));
        else skipImportDescriptor(source,kind);
      }
    } else if (section === 5) {
      const count = source.uleb();
      for (let index = 0; index < count; index += 1) {
        memories.push(Object.freeze({ source:"defined", module:null, name:null, ...limits(source) }));
      }
    }
    if (parsedSection && source.offset !== end) {
      throw new Error("WASM thread capability section payload is malformed");
    }
    source.offset = end;
  }
  if (memories.length !== 1) throw new Error(`owned engine must declare exactly one memory, got ${memories.length}`);
  const memory = memories[0];
  const threadSpawnImports = imports.filter((entry) => entry.name.includes("thread_spawn"))
    .map((entry) => `${entry.module}.${entry.name}`).sort();
  return Object.freeze({ memory, threadSpawnImports:Object.freeze(threadSpawnImports) });
}
