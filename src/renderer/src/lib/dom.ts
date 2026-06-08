export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function scrollToId(root: ParentNode, id: string): boolean {
  const element = root.querySelector(`[id="${CSS.escape(id)}"]`);
  if (!element) return false;
  element.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}
