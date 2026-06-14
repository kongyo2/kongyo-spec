export type ColumnAlign = "none" | "left" | "center" | "right";

export interface TableModel {
  aligns: ColumnAlign[];
  header: string[];
  rows: string[][];
}

function splitCells(line: string): string[] {
  const cells: string[] = [];
  let buf = "";
  let escaped = false;
  for (const ch of line) {
    if (escaped) {
      buf += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      buf += ch;
      escaped = true;
      continue;
    }
    if (ch === "|") {
      cells.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  cells.push(buf);
  return cells;
}

function splitRow(rawLine: string): string[] {
  const line = rawLine.trim();
  const cells = splitCells(line);
  if (line.startsWith("|") && cells.length > 0 && cells[0]!.trim() === "") cells.shift();
  if (line.endsWith("|") && cells.length > 0 && cells[cells.length - 1]!.trim() === "") cells.pop();
  return cells.map((cell) => cell.trim());
}

function parseAlign(cell: string): ColumnAlign {
  const trimmed = cell.trim();
  const left = trimmed.startsWith(":");
  const right = trimmed.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return "none";
}

function unescapePipes(cell: string): string {
  return cell.replace(/\\\|/g, "|");
}

function escapePipes(cell: string): string {
  return cell.replace(/\r\n?|\n/g, " ").replace(/\|/g, "\\|");
}

function fit<T>(values: T[], length: number, fill: T): T[] {
  const out = values.slice(0, length);
  while (out.length < length) out.push(fill);
  return out;
}

export function parseTable(raw: string): TableModel {
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const header = splitRow(lines[0] ?? "");
  const delimiter = splitRow(lines[1] ?? "");
  const body = lines.slice(2).map(splitRow);
  const cols = Math.max(1, header.length, delimiter.length, ...body.map((row) => row.length));
  const aligns: ColumnAlign[] = [];
  for (let c = 0; c < cols; c++) aligns.push(parseAlign(delimiter[c] ?? ""));
  return {
    aligns,
    header: fit(header, cols, "").map(unescapePipes),
    rows: body.map((row) => fit(row, cols, "").map(unescapePipes)),
  };
}

function charWidth(cp: number): number {
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

function displayWidth(value: string): number {
  let width = 0;
  for (const ch of value) width += charWidth(ch.codePointAt(0) ?? 0);
  return width;
}

function padCell(value: string, width: number, align: ColumnAlign): string {
  const gap = width - displayWidth(value);
  if (gap <= 0) return value;
  if (align === "right") return " ".repeat(gap) + value;
  if (align === "center") {
    const left = Math.floor(gap / 2);
    return " ".repeat(left) + value + " ".repeat(gap - left);
  }
  return value + " ".repeat(gap);
}

function delimiterCell(width: number, align: ColumnAlign): string {
  if (align === "center") return `:${"-".repeat(Math.max(1, width - 2))}:`;
  if (align === "left") return `:${"-".repeat(Math.max(1, width - 1))}`;
  if (align === "right") return `${"-".repeat(Math.max(1, width - 1))}:`;
  return "-".repeat(Math.max(3, width));
}

export function serializeTable(model: TableModel): string {
  const cols = Math.max(1, model.aligns.length);
  const header = fit(model.header, cols, "").map(escapePipes);
  const body = model.rows.map((row) => fit(row, cols, "").map(escapePipes));
  const aligns = fit(model.aligns, cols, "none" as ColumnAlign);

  const widths: number[] = [];
  for (let c = 0; c < cols; c++) {
    let width = displayWidth(header[c] ?? "");
    for (const row of body) width = Math.max(width, displayWidth(row[c] ?? ""));
    widths[c] = Math.max(3, width);
  }

  const formatRow = (cells: string[]): string =>
    `| ${cells.map((cell, c) => padCell(cell ?? "", widths[c]!, aligns[c]!)).join(" | ")} |`;
  const delimiter = `| ${aligns.map((align, c) => delimiterCell(widths[c]!, align)).join(" | ")} |`;

  return [formatRow(header), delimiter, ...body.map(formatRow)].join("\n");
}

export function createEmptyTable(cols = 3, rows = 2): TableModel {
  const span = Math.max(1, cols);
  return {
    aligns: Array.from({ length: span }, () => "none" as ColumnAlign),
    header: Array.from({ length: span }, (_, c) => `列${c + 1}`),
    rows: Array.from({ length: Math.max(0, rows) }, () => Array.from({ length: span }, () => "")),
  };
}

export function columnCount(model: TableModel): number {
  return Math.max(1, model.aligns.length);
}

export function setCell(model: TableModel, row: number, col: number, value: string): TableModel {
  if (row < 0) {
    const header = model.header.slice();
    header[col] = value;
    return { ...model, header };
  }
  const rows = model.rows.map((current, index) => {
    if (index !== row) return current;
    const next = current.slice();
    next[col] = value;
    return next;
  });
  return { ...model, rows };
}

export function setAlign(model: TableModel, col: number, align: ColumnAlign): TableModel {
  const aligns = model.aligns.slice();
  aligns[col] = align;
  return { ...model, aligns };
}

const ALIGN_CYCLE: ColumnAlign[] = ["none", "left", "center", "right"];

export function cycleAlign(align: ColumnAlign): ColumnAlign {
  const index = ALIGN_CYCLE.indexOf(align);
  return ALIGN_CYCLE[(index + 1) % ALIGN_CYCLE.length]!;
}

export function insertColumn(model: TableModel, at: number): TableModel {
  const cols = columnCount(model);
  const index = Math.max(0, Math.min(at, cols));
  const splice = <T>(arr: T[], value: T): T[] => {
    const next = arr.slice();
    next.splice(index, 0, value);
    return next;
  };
  return {
    aligns: splice(model.aligns, "none"),
    header: splice(model.header, ""),
    rows: model.rows.map((row) => splice(row, "")),
  };
}

export function deleteColumn(model: TableModel, at: number): TableModel {
  if (columnCount(model) <= 1) return model;
  const remove = <T>(arr: T[]): T[] => arr.filter((_, index) => index !== at);
  return {
    aligns: remove(model.aligns),
    header: remove(model.header),
    rows: model.rows.map(remove),
  };
}

export function insertRow(model: TableModel, at: number): TableModel {
  const cols = columnCount(model);
  const index = Math.max(0, Math.min(at, model.rows.length));
  const rows = model.rows.slice();
  rows.splice(
    index,
    0,
    Array.from({ length: cols }, () => ""),
  );
  return { ...model, rows };
}

export function deleteRow(model: TableModel, at: number): TableModel {
  return { ...model, rows: model.rows.filter((_, index) => index !== at) };
}
