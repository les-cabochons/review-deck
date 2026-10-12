// Tiny POSIX path helpers (browser-safe replacement for node:path).

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

export function join(...parts: string[]): string {
  return normalize(parts.filter(Boolean).join("/"));
}

const CODE_EXT = /\.(d\.ts|tsx?|jsx?|mjs|cjs|mts|cts)$/;

export function stripExtension(path: string): string {
  return path.replace(CODE_EXT, "");
}

export function isTestPath(path: string): boolean {
  return /(^|\/)(tests?|__tests__|spec)\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
}

/** Maps tests/foo/bar.test.ts -> foo/bar and src/foo/bar.ts -> foo/bar, so tests and code can be compared. */
export function logicalModule(path: string): string {
  return stripExtension(path)
    .replace(/\.(test|spec)$/, "")
    .replace(/^(src|lib|tests?|__tests__|spec)\//, "");
}
