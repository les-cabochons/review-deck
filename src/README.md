# Packages

Every folder directly under `src/` is a package, and every package is a **deep module**: a lot of behaviour behind a small interface. Its public surface is its **entry points**, the files at the package root. Everything in a subfolder is private.

```
src/
  pipeline.ts       ← app code (not a package)
  <name>/
    index.ts        ← an entry point (public). Import this from outside.
    client.ts       ← another entry point. A package may expose several.
    lib/            ← implementation: hidden from outside, free to import each other.
    tests/          ← tests and fixtures (a subfolder, so private).
```

`src/example/` is a starter template: copy it to start a package, or delete it.

**Import only through a package's entry points (its root files).** Don't write barrel files that re-export a whole subtree through one `index.ts`. Expose several small entry points instead, and keep the implementation in subfolders.

## Rules

Enforced by [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) in `.dependency-cruiser.cjs`. All are errors.

1. **Entry-point boundary.** Code outside a package (`src/pipeline.ts`, `extension/`, `backend/`, `scripts/`, or another package) may import only that package's root files, never anything in its subfolders.
2. **Intra-package freedom.** A package's own files import each other freely, subfolders included.
3. **Tests through the entry points.** Files under `<name>/tests/` may import any package's entry points and their own `tests/` fixtures, but no package's subfolder internals, not even their own. Nothing outside `tests/` may import a test fixture.
4. **No cycles.** No dependency cycles inside `src/`.

Packages are flat: a package's internals may nest as deep as you like, but a package can't contain another package.

## Running it

```sh
npm run lint:boundaries   # also part of `just check` and CI
npm test                  # runs src/*/tests/*.test.ts
```
