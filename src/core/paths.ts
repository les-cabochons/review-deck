// Tiny POSIX path helpers (browser-safe replacement for node:path).
import { GRAMMARS } from "../parse/grammars.js";

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

// Extensions of the files we parse: `src/a.ts` and `src/a.py` are both the module `src/a`.
const extensions = Object.values(GRAMMARS).flatMap((g) => g.extensions.map((e) => e.replace(/\+/g, "\\+")));
const CODE_EXT = new RegExp(`\\.(d\\.ts|${extensions.join("|")})$`);

export function stripExtension(path: string): string {
  return path.replace(CODE_EXT, "");
}

// Test file naming per ecosystem: foo.test.ts, test_foo.py / foo_test.py, foo_test.go, foo_spec.rb,
// FooTest.java / FooTests.cs / FooTest.php, foo_test.cpp.
const TEST_FILE = [
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)test_[^/]+\.py$/,
  /_test\.(py|go|rb|c|cc|cpp|cxx)$/,
  /_spec\.rb$/,
  /(Test|Tests)\.(java|cs|php)$/,
];

export function isTestPath(path: string): boolean {
  return /(^|\/)(tests?|__tests__|spec)\//.test(path) || TEST_FILE.some((re) => re.test(path));
}

/** Maps tests/foo/bar.test.ts -> foo/bar and src/foo/bar.ts -> foo/bar, so tests and code can be compared. */
export function logicalModule(path: string): string {
  return stripExtension(path)
    .replace(/\.(test|spec)$/, "")
    // Maven/Gradle layout: src/main/java/x and src/test/java/x are the same package.
    .replace(/^src\/(main|test)\/java\//, "")
    .replace(/^(src|lib|tests?|__tests__|spec)\//, "");
}
