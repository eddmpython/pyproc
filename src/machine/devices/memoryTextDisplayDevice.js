// memoryTextDisplayDevice.js - 단일 producer의 text cell frame을 원자적으로 present한다.
import { WebMachineError } from "../contracts/webMachineError.js";

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${label}는 양의 정수여야 한다`);
  return value;
}

export class MemoryTextDisplayDevice {
  constructor({ maxColumns = 240, maxRows = 120 } = {}) {
    this.kind = "display";
    this.mode = "text-cells";
    this.maxColumns = positiveInteger(maxColumns, "maxColumns");
    this.maxRows = positiveInteger(maxRows, "maxRows");
    this._endpoint = null;
    this._workingColumns = 0;
    this._workingRows = 0;
    this._presentedColumns = 0;
    this._presentedRows = 0;
    this._workingCells = new Uint32Array(0);
    this._presentedCells = new Uint32Array(0);
    this._revision = 0;
    this._writes = 0;
    this._presentations = 0;
    this._listenerErrors = 0;
    this._listeners = new Set();
    this._dirty = false;
  }

  connect({ endpointId }) {
    const id = String(endpointId || "");
    if (!id) throw new TypeError("endpointId가 필요하다");
    if (this._endpoint) {
      const code = this._endpoint.id === id ? "WEB_MACHINE_DISPLAY_ENDPOINT_DUPLICATE" : "WEB_MACHINE_DISPLAY_BUSY";
      throw new WebMachineError(code, `display 연결 중: ${this._endpoint.id}`);
    }
    const endpoint = { id, closed: false };
    this._endpoint = endpoint;
    return Object.freeze({
      endpointId: id,
      configure: (size) => this._configure(endpoint, size),
      writeCell: (cell) => this._writeCell(endpoint, cell),
      present: () => this._present(endpoint),
      close: () => this._disconnect(endpoint),
    });
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("display listener는 함수여야 한다");
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  readFrame() {
    return Object.freeze({
      mode: this.mode,
      columns: this._presentedColumns,
      rows: this._presentedRows,
      revision: this._revision,
      cells: this._presentedCells.slice(),
    });
  }

  inspect() {
    return {
      kind: this.kind,
      mode: this.mode,
      attached: !!this._endpoint,
      endpointId: this._endpoint?.id || null,
      columns: this._presentedColumns,
      rows: this._presentedRows,
      revision: this._revision,
      writes: this._writes,
      presentations: this._presentations,
      listenerErrors: this._listenerErrors,
      dirty: this._dirty,
    };
  }

  _configure(endpoint, { columns, rows } = {}) {
    this._assertEndpoint(endpoint);
    positiveInteger(columns, "display columns");
    positiveInteger(rows, "display rows");
    if (columns > this.maxColumns || rows > this.maxRows) {
      throw new WebMachineError("WEB_MACHINE_DISPLAY_SIZE", `display 크기 초과: ${columns}x${rows}/${this.maxColumns}x${this.maxRows}`);
    }
    if (columns === this._workingColumns && rows === this._workingRows) return;
    this._workingColumns = columns;
    this._workingRows = rows;
    this._workingCells = new Uint32Array(columns * rows);
    this._dirty = true;
  }

  _writeCell(endpoint, { row, column, glyph } = {}) {
    this._assertEndpoint(endpoint);
    if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 || row >= this._workingRows || column >= this._workingColumns) {
      throw new WebMachineError("WEB_MACHINE_DISPLAY_RANGE", `display cell 범위 불일치: ${row},${column}/${this._workingRows},${this._workingColumns}`);
    }
    if (!Number.isInteger(glyph) || glyph < 0 || glyph > 0x10ffff) {
      throw new WebMachineError("WEB_MACHINE_DISPLAY_GLYPH", `display glyph 불일치: ${glyph}`);
    }
    this._workingCells[row * this._workingColumns + column] = glyph;
    this._writes += 1;
    this._dirty = true;
  }

  _present(endpoint) {
    this._assertEndpoint(endpoint);
    if (!this._dirty) return this._revision;
    this._presentedCells = this._workingCells.slice();
    this._presentedColumns = this._workingColumns;
    this._presentedRows = this._workingRows;
    this._revision += 1;
    this._presentations += 1;
    this._dirty = false;
    for (const listener of this._listeners) {
      try {
        listener(this.readFrame());
      } catch (error) {
        this._listenerErrors += 1;
      }
    }
    return this._revision;
  }

  _disconnect(endpoint) {
    if (endpoint.closed) return;
    endpoint.closed = true;
    if (this._endpoint === endpoint) this._endpoint = null;
  }

  _assertEndpoint(endpoint) {
    if (endpoint.closed || this._endpoint !== endpoint) {
      throw new WebMachineError("WEB_MACHINE_DISPLAY_PORT_CLOSED", `display port 닫힘: ${endpoint.id}`);
    }
  }
}
