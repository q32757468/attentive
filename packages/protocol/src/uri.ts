export const MAX_OPEN_URI_LENGTH = 4096;
export const OPEN_URI_SCHEMES = ["http:", "https:", "vscode:"] as const;

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isOpenUri(value: string): boolean {
  if (value.length === 0 || value.length > MAX_OPEN_URI_LENGTH) {
    return false;
  }
  try {
    const uri = new URL(value);
    return (OPEN_URI_SCHEMES as readonly string[]).includes(uri.protocol);
  } catch {
    return false;
  }
}
