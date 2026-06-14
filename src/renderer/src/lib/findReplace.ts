export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface FindMatch {
  start: number;
  end: number;
}

const MAX_MATCHES = 50000;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildSearchRegExp(query: string, options: FindOptions): RegExp | null {
  if (query.length === 0) return null;
  let pattern = options.regex ? query : escapeRegExp(query);
  if (options.wholeWord) pattern = `\\b(?:${pattern})\\b`;
  try {
    return new RegExp(pattern, options.caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}

export function findMatches(content: string, query: string, options: FindOptions): FindMatch[] {
  const regex = buildSearchRegExp(query, options);
  if (!regex) return [];
  const matches: FindMatch[] = [];
  let match = regex.exec(content);
  while (match !== null) {
    if (match[0].length === 0) {
      regex.lastIndex += 1;
    } else {
      matches.push({ start: match.index, end: match.index + match[0].length });
      if (matches.length >= MAX_MATCHES) break;
    }
    match = regex.exec(content);
  }
  return matches;
}

function expandGroups(matched: string, regex: RegExp, replacement: string): string {
  const nonGlobal = new RegExp(regex.source, regex.flags.replace("g", ""));
  return matched.replace(nonGlobal, replacement);
}

export function replaceOne(
  content: string,
  match: FindMatch,
  query: string,
  replacement: string,
  options: FindOptions,
): { content: string; caret: number } {
  let value = replacement;
  if (options.regex) {
    const regex = buildSearchRegExp(query, options);
    if (regex) value = expandGroups(content.slice(match.start, match.end), regex, replacement);
  }
  return {
    content: content.slice(0, match.start) + value + content.slice(match.end),
    caret: match.start + value.length,
  };
}

export function replaceAll(
  content: string,
  query: string,
  replacement: string,
  options: FindOptions,
): { content: string; count: number } {
  const matches = findMatches(content, query, options);
  if (matches.length === 0) return { content, count: 0 };
  const regex = options.regex ? buildSearchRegExp(query, options) : null;
  let next = content;
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i]!;
    const value = regex ? expandGroups(content.slice(match.start, match.end), regex, replacement) : replacement;
    next = next.slice(0, match.start) + value + next.slice(match.end);
  }
  return { content: next, count: matches.length };
}
