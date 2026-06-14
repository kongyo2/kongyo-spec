export type InlineFormat = "bold" | "italic" | "strikethrough" | "code";
export type BlockFormat = "h1" | "h2" | "h3" | "quote" | "ul" | "ol" | "task";
export type InsertFormat = "link" | "image" | "codeblock" | "hr" | "table" | "toc";
export type FormatAction = InlineFormat | BlockFormat | InsertFormat;

export interface FormatInput {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface FormatResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface FormatContext {
  toc?: string;
}

const INLINE_MARK: Record<InlineFormat, string> = {
  bold: "**",
  italic: "*",
  strikethrough: "~~",
  code: "`",
};

const HEADING_PREFIX: Record<"h1" | "h2" | "h3", string> = {
  h1: "# ",
  h2: "## ",
  h3: "### ",
};

const INLINE_PLACEHOLDER: Record<InlineFormat, string> = {
  bold: "太字",
  italic: "斜体",
  strikethrough: "打ち消し",
  code: "コード",
};

function toggleInline(input: FormatInput, format: InlineFormat): FormatResult {
  const { value, selectionStart: start, selectionEnd: end } = input;
  const mark = INLINE_MARK[format];
  const len = mark.length;
  const selected = value.slice(start, end);

  if (selected.length >= len * 2 && selected.startsWith(mark) && selected.endsWith(mark)) {
    const inner = selected.slice(len, selected.length - len);
    return {
      value: value.slice(0, start) + inner + value.slice(end),
      selectionStart: start,
      selectionEnd: start + inner.length,
    };
  }

  if (value.slice(start - len, start) === mark && value.slice(end, end + len) === mark) {
    return {
      value: value.slice(0, start - len) + selected + value.slice(end + len),
      selectionStart: start - len,
      selectionEnd: end - len,
    };
  }

  if (start === end) {
    const placeholder = INLINE_PLACEHOLDER[format];
    const next = value.slice(0, start) + mark + placeholder + mark + value.slice(end);
    return { value: next, selectionStart: start + len, selectionEnd: start + len + placeholder.length };
  }

  const next = value.slice(0, start) + mark + selected + mark + value.slice(end);
  return { value: next, selectionStart: start + len, selectionEnd: end + len };
}

function blockBounds(value: string, start: number, end: number): [number, number] {
  const blockStart = value.lastIndexOf("\n", start - 1) + 1;
  let blockEnd = value.indexOf("\n", end);
  if (blockEnd === -1) blockEnd = value.length;
  if (end > start && end === blockStart) blockEnd = end - 1 >= 0 ? end - 1 : end;
  return [blockStart, blockEnd];
}

function mapBlock(input: FormatInput, transform: (lines: string[]) => string[]): FormatResult {
  const { value, selectionStart: start, selectionEnd: end } = input;
  const [blockStart, blockEnd] = blockBounds(value, start, end);
  const block = value.slice(blockStart, blockEnd);
  const next = transform(block.split("\n")).join("\n");
  return {
    value: value.slice(0, blockStart) + next + value.slice(blockEnd),
    selectionStart: blockStart,
    selectionEnd: blockStart + next.length,
  };
}

function splitIndent(line: string): [string, string] {
  const match = /^(\s*)(.*)$/s.exec(line);
  return match ? [match[1]!, match[2]!] : ["", line];
}

function stripListMarker(body: string): string {
  return body.replace(/^(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/, "");
}

function toggleHeading(input: FormatInput, level: "h1" | "h2" | "h3"): FormatResult {
  const prefix = HEADING_PREFIX[level];
  return mapBlock(input, (lines) => {
    const meaningful = lines.filter((line) => line.trim().length > 0);
    const allSet = meaningful.length > 0 && meaningful.every((line) => line.startsWith(prefix));
    return lines.map((line) => {
      if (line.trim().length === 0) return line;
      const base = line.replace(/^#{1,6}\s+/, "");
      return allSet ? base : prefix + base;
    });
  });
}

function toggleQuote(input: FormatInput): FormatResult {
  return mapBlock(input, (lines) => {
    const meaningful = lines.filter((line) => line.trim().length > 0);
    const allSet = meaningful.length > 0 && meaningful.every((line) => /^>\s?/.test(line));
    return lines.map((line) => (allSet ? line.replace(/^>\s?/, "") : `> ${line}`));
  });
}

function toggleUnordered(input: FormatInput): FormatResult {
  return mapBlock(input, (lines) => {
    const meaningful = lines.filter((line) => line.trim().length > 0);
    const allSet = meaningful.length > 0 && meaningful.every((line) => /^\s*[-*+]\s+/.test(line));
    return lines.map((line) => {
      if (line.trim().length === 0) return line;
      const [indent, body] = splitIndent(line);
      return allSet ? indent + stripListMarker(body) : `${indent}- ${stripListMarker(body)}`;
    });
  });
}

function toggleOrdered(input: FormatInput): FormatResult {
  return mapBlock(input, (lines) => {
    const meaningful = lines.filter((line) => line.trim().length > 0);
    const allSet = meaningful.length > 0 && meaningful.every((line) => /^\s*\d+\.\s+/.test(line));
    let counter = 0;
    return lines.map((line) => {
      if (line.trim().length === 0) return line;
      const [indent, body] = splitIndent(line);
      if (allSet) return indent + stripListMarker(body);
      counter += 1;
      return `${indent}${counter}. ${stripListMarker(body)}`;
    });
  });
}

function toggleTask(input: FormatInput): FormatResult {
  return mapBlock(input, (lines) => {
    const meaningful = lines.filter((line) => line.trim().length > 0);
    const allSet = meaningful.length > 0 && meaningful.every((line) => /^\s*[-*+]\s+\[[ xX]\]\s+/.test(line));
    return lines.map((line) => {
      if (line.trim().length === 0) return line;
      const [indent, body] = splitIndent(line);
      return allSet ? indent + stripListMarker(body) : `${indent}- [ ] ${stripListMarker(body)}`;
    });
  });
}

function blockInsert(input: FormatInput, snippet: string, selOffset: number, selLength: number): FormatResult {
  const { value, selectionStart: start, selectionEnd: end } = input;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail = after.length === 0 ? "" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const base = start + lead.length;
  return {
    value: before + lead + snippet + trail + after,
    selectionStart: base + selOffset,
    selectionEnd: base + selOffset + selLength,
  };
}

const URL_LIKE = /^(?:https?:\/\/|mailto:|www\.|\.{0,2}\/|#)\S*$/i;

function insertLink(input: FormatInput, image: boolean): FormatResult {
  const { value, selectionStart: start, selectionEnd: end } = input;
  const selected = value.slice(start, end);
  const bang = image ? "!" : "";
  const textPlaceholder = image ? "代替テキスト" : "リンクテキスト";

  if (selected.length > 0 && URL_LIKE.test(selected.trim())) {
    const snippet = `${bang}[${textPlaceholder}](${selected.trim()})`;
    const selFrom = start + bang.length + 1;
    return {
      value: value.slice(0, start) + snippet + value.slice(end),
      selectionStart: selFrom,
      selectionEnd: selFrom + textPlaceholder.length,
    };
  }

  const text = selected.length > 0 ? selected : textPlaceholder;
  const snippet = `${bang}[${text}](url)`;
  if (selected.length > 0) {
    const selFrom = start + bang.length + 1 + text.length + 2;
    return {
      value: value.slice(0, start) + snippet + value.slice(end),
      selectionStart: selFrom,
      selectionEnd: selFrom + 3,
    };
  }
  const selFrom = start + bang.length + 1;
  return {
    value: value.slice(0, start) + snippet + value.slice(end),
    selectionStart: selFrom,
    selectionEnd: selFrom + text.length,
  };
}

function insertCodeBlock(input: FormatInput): FormatResult {
  const { value, selectionStart: start, selectionEnd: end } = input;
  const body = value.slice(start, end);
  const snippet = "```\n" + body + "\n```";
  return blockInsert(input, snippet, 3, 0);
}

const TABLE_SNIPPET = "| 見出し1 | 見出し2 |\n| --- | --- |\n| セル | セル |";

export function applyFormat(action: FormatAction, input: FormatInput, context?: FormatContext): FormatResult | null {
  switch (action) {
    case "bold":
    case "italic":
    case "strikethrough":
    case "code":
      return toggleInline(input, action);
    case "h1":
    case "h2":
    case "h3":
      return toggleHeading(input, action);
    case "quote":
      return toggleQuote(input);
    case "ul":
      return toggleUnordered(input);
    case "ol":
      return toggleOrdered(input);
    case "task":
      return toggleTask(input);
    case "link":
      return insertLink(input, false);
    case "image":
      return insertLink(input, true);
    case "codeblock":
      return insertCodeBlock(input);
    case "hr":
      return blockInsert(input, "---", 3, 0);
    case "table":
      return blockInsert(input, TABLE_SNIPPET, 2, 4);
    case "toc": {
      const toc = context?.toc ?? "";
      if (toc.length === 0) return null;
      return blockInsert(input, toc, toc.length, 0);
    }
  }
}
