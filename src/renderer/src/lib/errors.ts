export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function ipcErrorMessage(err: unknown): string {
  return errorMessage(err).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "");
}
