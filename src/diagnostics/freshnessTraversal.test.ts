/**
 * @fileoverview What the freshness check is allowed to walk — the 223-second field run, pinned.
 *
 * A real app composing three packages in an nx workspace spent 223.56 seconds in
 * `composition: freshness`, against 18.8ms for 482 files when the check shipped. The walkers were
 * innocent; the fingerprint was not. Two independent defects met in a workspace layout:
 *
 *  1. A glob `ignore` is ANCHORED at its scan root and filters RESULTS. `node_modules/**` removed
 *     matches under the scan root's own `node_modules` and pruned nothing nested, so the walk still
 *     descended into every package boundary inside the scan set.
 *  2. `fast-glob` follows symbolic links by default. A workspace links `a/node_modules/@scope/b` to
 *     `packages/b`, whose `node_modules` links back to `packages/a` — so once the walk was inside a
 *     `node_modules` it had no end, only a very slow middle.
 *
 * Both are fixed in the one enumeration generation and freshness share, so neither can come back
 * for only one of them. The fixture below is the field's shape: packages symlinked through
 * `node_modules`, each with its own `node_modules` linking back to its siblings, its own `dist`,
 * and a handful of real sources. Before the fix its case-C shape did not finish in nine minutes.
 *
 * The counts are the invariants here and the clock is the smoke alarm: an assertion that a
 * traversal took under ten seconds says nothing about WHICH files it read, and an assertion that it
 * read exactly the package's own sources says everything.
 */
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  currentInputsForPackageRoot,
  MAX_FINGERPRINTED_SOURCE_FILES,
} from "./currentInputsHash.js";
import { hashGenerationInputs } from "./generationState.js";
import { getDiscoveryTargetFiles } from "../generator/iocProgramContext.js";
import { resolveScanDirEntries } from "../generator/manifestPaths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iocManifestIndex = path.join(__dirname, "../index.js").replace(/\\/g, "/");

/**
 * The wall-time smoke alarm.
 *
 * Ten seconds is absurdly generous for work that measures in single-digit milliseconds — and that
 * is the point. It is sized to catch the failure mode (223 seconds, or no termination at all), not
 * to police a few hundred milliseconds of `tsx` config transpilation on a loaded CI box.
 */
const WALL_TIME_CEILING_MS = 10_000;

const FACTORY_COUNT = 6;
const write = (filePath: string, contents: string): void => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
};

const linkDir = (from: string, to: string): void => {
  mkdirSync(path.dirname(from), { recursive: true });
  symlinkSync(to, from, "dir");
};

const iocConfig = (packageName: string, scanDir: string): string =>
  `import { defineIocConfig } from "${iocManifestIndex}";

export default defineIocConfig({
  packageName: ${JSON.stringify(packageName)},
  discovery: {
    scanDirs: ${JSON.stringify([scanDir])},
    generatedDir: "src/generated",
    includes: ["**/*.{ts,tsx}"],
  },
});
`;

type Workspace = {
  readonly root: string;
  /** The package as a composed dependency resolves it: through the `node_modules` symlink. */
  readonly linkedRootOf: (name: string) => string;
  readonly realRootOf: (name: string) => string;
};

/**
 * The nx/pnpm shape, with every hazard the field run had.
 *
 * `scanDir` per package is a parameter because the explosion turned on it: a tight `src/factories`
 * never met a package boundary, and a scan root at the package root met three. Both must now come
 * back with the same six files.
 */
const buildWorkspace = (scanDir: string, extraPackages: string[] = []): Workspace => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ioc-walk-")));
  const names = ["lib-a", "lib-b", ...extraPackages];

  write(
    path.join(root, "package.json"),
    JSON.stringify({ name: "ws", private: true, workspaces: ["packages/*"] }),
  );

  // A third-party dependency with more files than any of the packages' sources, so a walk that
  // reaches it is visible in the count and not only on the clock.
  const dep = path.join(root, "node_modules", "bulky-dep");
  write(path.join(dep, "package.json"), JSON.stringify({ name: "bulky-dep" }));
  for (let i = 0; i < 40; i += 1) {
    write(path.join(dep, "lib", `m${i}.ts`), `export const v${i} = ${i};\n`);
  }

  for (const name of names) {
    const pkg = path.join(root, "packages", name);
    write(
      path.join(pkg, "package.json"),
      JSON.stringify({ name: `@scope/${name}`, type: "module" }),
    );
    write(path.join(pkg, "src", "ioc.config.ts"), iocConfig(`@scope/${name}`, scanDir));
    for (let i = 0; i < FACTORY_COUNT; i += 1) {
      write(
        path.join(pkg, "src", "factories", `f${i}.ts`),
        `export const build${name.replace("-", "")}${i} = () => ${i};\n`,
      );
    }
    // Build output, beside the sources and never part of them.
    for (let i = 0; i < 25; i += 1) {
      write(path.join(pkg, "dist", `f${i}.ts`), `export const x${i} = ${i};\n`);
    }
  }

  // The cycle: every package's own `node_modules` links to its siblings, which link back.
  for (const name of names) {
    const nm = path.join(root, "packages", name, "node_modules");
    for (const other of names) {
      if (other !== name) {
        linkDir(path.join(nm, "@scope", other), path.join(root, "packages", other));
      }
    }
    linkDir(path.join(nm, "bulky-dep"), dep);
    linkDir(
      path.join(root, "node_modules", "@scope", name),
      path.join(root, "packages", name),
    );
  }

  return {
    root,
    linkedRootOf: (name) => path.join(root, "node_modules", "@scope", name),
    realRootOf: (name) => path.join(root, "packages", name),
  };
};

const timed = async <T>(fn: () => Promise<T>): Promise<[T, number]> => {
  const started = performance.now();
  const value = await fn();
  return [value, performance.now() - started];
};

describe("freshness fingerprints the discovery scan set and nothing else", () => {
  for (const scanDir of ["src/factories", "src", "."]) {
    it(`hashes exactly the package's own sources with scanDirs ${JSON.stringify(scanDir)}`, async () => {
      const ws = buildWorkspace(scanDir);
      const linked = ws.linkedRootOf("lib-a");

      const [result, elapsedMs] = await timed(() =>
        currentInputsForPackageRoot(linked),
      );

      assert.equal(
        result.unknown,
        undefined,
        `expected a fingerprint, got ${JSON.stringify(result.unknown)}`,
      );
      assert.ok(
        elapsedMs < WALL_TIME_CEILING_MS,
        `freshness took ${elapsedMs.toFixed(0)}ms; the field regression was 223s and the pre-fix walk did not terminate at all`,
      );

      // The structural half: the hash is over the discovery scan set, byte for byte. Recomputing it
      // from the enumeration generation uses proves the two sides cannot have hashed different
      // files — a match here is the only thing that makes the count below meaningful.
      const files = await getDiscoveryTargetFiles(
        resolveScanDirEntries(linked, [{ path: scanDir }]),
        ["**/*.{ts,tsx}"],
        [
          "**/*.d.ts",
          "**/*.{test,tests}.{ts,tsx,js,mjs,cjs}",
          "**/*.{spec,specs}.{ts,tsx,js,mjs,cjs}",
          "generated/**/*",
          "dist/**/*",
          "node_modules/**/*",
        ],
        path.join(linked, "src", "generated"),
      );
      // `src/factories` holds only the factories; the wider roots also reach `src/ioc.config.ts`,
      // which is a source of this package and nothing else's.
      const expected =
        scanDir === "src/factories" ? FACTORY_COUNT : FACTORY_COUNT + 1;
      assert.equal(
        files.length,
        expected,
        `hashed ${files.length} files; a scan root of ${JSON.stringify(scanDir)} must reach this package's sources and no other package's`,
      );
      assert.equal(
        result.hash,
        hashGenerationInputs(
          linked,
          path.join(linked, "src", "ioc.config.ts"),
          files,
        ),
      );
    });
  }

  it("hashes no file under node_modules or dist, however wide the scan root", async () => {
    const ws = buildWorkspace(".");
    const linked = ws.linkedRootOf("lib-a");

    const files = await getDiscoveryTargetFiles(
      resolveScanDirEntries(linked, [{ path: "." }]),
      ["**/*.{ts,tsx}"],
      [],
      path.join(linked, "src", "generated"),
    );

    // Relative to the scan root, because the scan root is itself reached THROUGH a `node_modules`
    // symlink — the absolute paths all contain the word, and only what lies below the root is a
    // package boundary this walk crossed.
    const belowRoot = files.map((file) => path.relative(linked, file));
    assert.deepEqual(
      belowRoot.filter((rel) => rel.split(path.sep).includes("node_modules")),
      [],
      "walked into a nested node_modules",
    );

    // Pinned by count, not by timing: with EVERY config exclude removed, the structural boundaries
    // still hold. `dist` is the config's business and comes back — 25 build outputs, 6 factories,
    // one config — while the sibling packages the `node_modules` cycle links to never do.
    assert.equal(files.length, 25 + FACTORY_COUNT + 1);
  });

  it("hashes a symlinked composed package's own sources, not the workspace it links into", async () => {
    const ws = buildWorkspace("src/factories");
    const linked = ws.linkedRootOf("lib-a");

    const files = await getDiscoveryTargetFiles(
      resolveScanDirEntries(linked, [{ path: "src/factories" }]),
      ["**/*.{ts,tsx}"],
      ["**/*.d.ts"],
      path.join(linked, "src", "generated"),
    );

    assert.equal(files.length, FACTORY_COUNT);
    const foreign = files.filter(
      (file) => !file.startsWith(linked + path.sep) && !file.startsWith(ws.realRootOf("lib-a") + path.sep),
    );
    assert.deepEqual(foreign, [], "freshness reached outside the package it was asked about");
  });
});

describe("freshness declines rather than guessing", () => {
  it("returns unknown for a composed package with no config of its own, without walking it", async () => {
    const ws = buildWorkspace("src/factories");
    const orphan = path.join(ws.root, "packages", "no-config");
    write(
      path.join(orphan, "package.json"),
      JSON.stringify({ name: "@scope/no-config", type: "module" }),
    );
    for (let i = 0; i < 20; i += 1) {
      write(path.join(orphan, "src", `s${i}.ts`), `export const s${i} = ${i};\n`);
    }
    // A cycle, deliberately: any fallback traversal of this package root would not terminate, so
    // "no hashing occurred" is pinned by construction and not only by the clock below.
    linkDir(path.join(orphan, "node_modules", "@scope", "self"), orphan);
    linkDir(path.join(ws.root, "node_modules", "@scope", "no-config"), orphan);

    const [result, elapsedMs] = await timed(() =>
      currentInputsForPackageRoot(ws.linkedRootOf("no-config")),
    );

    assert.equal(result.hash, undefined, "a package with no config must not be fingerprinted");
    assert.equal(result.unknown?.reason, "unreadable-sources");
    assert.ok(
      elapsedMs < 250,
      `took ${elapsedMs.toFixed(0)}ms — a missing config must be answered by two existence checks, not by a traversal`,
    );
  });

  it("returns unknown naming the count when the resolved set breaches the ceiling", async () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ioc-ceiling-")));
    const pkg = path.join(root, "packages", "huge");
    write(path.join(pkg, "package.json"), JSON.stringify({ name: "@scope/huge", type: "module" }));
    write(path.join(pkg, "src", "ioc.config.ts"), iocConfig("@scope/huge", "src/factories"));

    const overCeiling = MAX_FINGERPRINTED_SOURCE_FILES + 1;
    for (let i = 0; i < overCeiling; i += 1) {
      write(path.join(pkg, "src", "factories", `f${i}.ts`), `export const f${i} = ${i};\n`);
    }

    const [result, elapsedMs] = await timed(() => currentInputsForPackageRoot(pkg));

    assert.equal(result.hash, undefined, "a set past the ceiling must not be hashed at all");
    assert.equal(result.unknown?.reason, "source-set-too-large");
    assert.match(
      result.unknown?.detail ?? "",
      new RegExp(`${overCeiling} files resolved, over the ${MAX_FINGERPRINTED_SOURCE_FILES}-file ceiling`),
      `the reason must name the count that caused it; got ${JSON.stringify(result.unknown?.detail)}`,
    );
    assert.ok(
      elapsedMs < WALL_TIME_CEILING_MS,
      `took ${elapsedMs.toFixed(0)}ms — the ceiling exists so a freshness heuristic never dominates the run it advises on`,
    );
  });
});
