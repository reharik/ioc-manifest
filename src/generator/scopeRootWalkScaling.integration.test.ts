/**
 * DAG discipline in the group-hop walks, pinned by shape and by clock.
 *
 * ### The failure class
 *
 * A scope root's subtree is a DAG, not a tree. A group hop makes that acute: one edge fans out to
 * every member of the group, and in a real service those members share almost all of their depth —
 * the unit of work, the repositories, the logger, the database connection. A walk that expands a
 * unit once per PATH rather than once per UNIT therefore does work proportional to the number of
 * distinct root-to-leaf paths, which is exponential in the depth of a graph that has only a few
 * dozen nodes in it. The field symptom is a generation run that spins one core for minutes and
 * prints nothing, on a graph a reader would call small.
 *
 * ### What is pinned here
 *
 * The structural pin is the load-bearing one and it cannot flake: the subtree a variant reports
 * over a graph with hundreds of thousands of distinct paths must contain each unit ONCE. If any
 * walker ever re-expands a shared subtree per path, that count is the first thing to move, and it
 * moves by orders of magnitude.
 *
 * The clock pins sit on top of it as the coarse backstop — a wall-time ceiling and a growth ratio.
 * Both are deliberately loose (see the margin notes at each) because a perf assertion that flakes
 * is worse than no perf assertion: it teaches the next reader to re-run until green. They are sized
 * to catch the failure CLASS (minutes instead of milliseconds), never to police a few percent.
 *
 * The fixture is the field's shape: an app whose scope roots reach a composed package's record
 * group, whose members share a deep spine. It is built on disk per test, half of it under
 * `node_modules`, for the same reason `composedSubtreeDemand.integration.test.ts` is.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { discoverFactories } from "./discoverFactories/discoverFactories.js";
import { loadComposedManifestSupply } from "./loadComposedManifestUnits.js";
import { buildRegistrationPlan } from "./resolveRegistrationPlan.js";
import {
  demandersFromUnitEdges,
  resolveExternalsExclusion,
} from "./scopeRootExternalsExclusion.js";
import {
  buildScopeRootSupplyIndex,
  verifyScopeRoots,
} from "./verifyScopeRoots.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scopeRootModule = path
  .join(__dirname, "../scopeRoots/scopeRoot.js")
  .replace(/\\/g, "/");

const LIB = "@test/lib-commands";

/**
 * The shared spine, as a layered DAG.
 *
 * `LAYERS` levels of `WIDTH` units, each demanding `FANOUT` units of the level below. That is 64
 * distinct units and 5^7 ≈ 78,000 distinct paths from any top-layer unit down to a leaf — before
 * the group hop multiplies it by the member count. A DAG walk is linear in the 64; a tree walk is
 * linear in the 78,000 × members. The gap between those two is the entire subject of this file.
 */
const LAYERS = 8;
const WIDTH = 8;
const FANOUT = 5;

/** A unit on the deepest layer — the entry point an outside consumer uses to reach the spine. */
const TOP_SPINE_KEY = `spine${(LAYERS - 1) * WIDTH}`;

type LibraryOptions = {
  members: number;
  /** One member demands the group it belongs to — a genuine cycle through the group hop. */
  cycle?: boolean;
};

const unitEntry = (
  contractName: string,
  registrationKey: string,
  dependencyKeys: readonly string[],
  moduleIndex: number,
): string => `    ${contractName}: {
      ${registrationKey}: {
        exportName: "build${contractName}",
        registrationKey: "${registrationKey}",
        modulePath: "services/build${contractName}.ts",
        relImport: "../services/build${contractName}.js",
        contractName: "${contractName}",
        implementationName: "${registrationKey}",
        lifetime: "scoped",
        moduleIndex: ${moduleIndex},
        default: true,
        dependencyKeys: ${JSON.stringify(dependencyKeys)},
      },
    },`;

/** The composed library's manifest source, the only thing a composing app ever sees of a library. */
const libraryManifest = ({ members, cycle }: LibraryOptions): string => {
  const rows: string[] = [];
  let moduleIndex = 0;

  const spineKey = (layer: number, index: number): string =>
    `spine${layer * WIDTH + index}`;

  for (let layer = 0; layer < LAYERS; layer += 1) {
    for (let index = 0; index < WIDTH; index += 1) {
      const deps =
        layer === 0
          ? []
          : Array.from({ length: FANOUT }, (_, f) =>
              spineKey(layer - 1, (index + f) % WIDTH),
            );
      const key = spineKey(layer, index);
      rows.push(
        unitEntry(`Spine${layer * WIDTH + index}`, key, deps, moduleIndex),
      );
      moduleIndex += 1;
    }
  }

  const memberKeys: string[] = [];
  for (let m = 0; m < members; m += 1) {
    const key = `handler${m}`;
    memberKeys.push(key);
    const deps = [
      ...(cycle === true && m === 0 ? ["commandHandlers"] : []),
      ...Array.from({ length: FANOUT }, (_, f) =>
        spineKey(LAYERS - 1, (m + f) % WIDTH),
      ),
      "viewerId",
    ];
    rows.push(unitEntry(`Handler${m}`, key, deps, moduleIndex));
    moduleIndex += 1;
  }

  const memberRows = memberKeys
    .map(
      (key, m) =>
        `      ${key}: { contractName: "Handler${m}", registrationKey: "${key}" },`,
    )
    .join("\n");

  return `export const iocManifest = {
  manifestSchemaVersion: 3,

  moduleImports: [],

  contracts: {
${rows.join("\n")}
  },

  commandHandlers: {
    kind: "object",
    baseType: "CommandHandler",
    baseTypeId: "${LIB}/src/types/CommandHandler.ts:CommandHandler",
    members: {
${memberRows}
    },
  },
};

export const IOC_SCOPE_PROVIDED_KEYS = [] as const;

export const IOC_MANIFEST_FEATURES = ["dependencyKeys"] as const;
`;
};

const APP_CONTRACTS = `export interface IApiScope {
  handle: (p: string) => string;
}
export interface IWorkerScope {
  handle: (p: string) => string;
}
export interface IAdminScope {
  handle: (p: string) => string;
}
export interface IAuditTrail {
  write: (line: string) => void;
}
`;

/** Three boundaries, all of whose subtrees reach the same group — the field's shape. */
const appScopeRoot = (name: string, contract: string): string =>
  `import type { ScopeRoot } from "${scopeRootModule}";
import type { ${contract} } from "../contracts.js";

type Deps = { commandHandlers: unknown };

export const build${name} = ({
  commandHandlers,
}: Deps): ScopeRoot<${contract}, { viewerId: string }> => ({
  handle: (p: string) => {
    void commandHandlers;
    return p;
  },
});
`;

/**
 * A local unit OUTSIDE every declaring subtree that demands the declared key — and reaches into the
 * shared spine while doing it.
 *
 * Both halves matter. Demanding `viewerId` from outside is what the exclusion predicate exists to
 * notice. Demanding a top-of-spine key is what gives the outside-reachability walk a real graph to
 * descend: without it that walk terminates at its first hop, and a visited set removed from it
 * would go unnoticed by everything in this file.
 */
const APP_AUDIT_TRAIL = `import type { IAuditTrail } from "../contracts.js";

type Deps = { viewerId: string; ${TOP_SPINE_KEY}: unknown };

export const buildAuditTrail = ({ viewerId, ${TOP_SPINE_KEY} }: Deps): IAuditTrail => ({
  write: (line: string) => {
    void ${TOP_SPINE_KEY};
    void \`\${viewerId}:\${line}\`;
  },
});
`;

type Fixture = {
  projectRoot: string;
  files: string[];
  scanDirs: { absPath: string }[];
  packageNames: string[];
};

const buildFixture = (options: LibraryOptions): Fixture => {
  const root = mkdtempSync(path.join(tmpdir(), "ioc-walk-scaling-"));
  const srcDir = path.join(root, "src");
  const factoriesDir = path.join(srcDir, "factories");
  mkdirSync(factoriesDir, { recursive: true });

  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "@test/app", type: "module" }),
  );

  const pkgDir = path.join(root, "node_modules", ...LIB.split("/"));
  mkdirSync(path.join(pkgDir, "generated"), { recursive: true });
  writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({
      name: LIB,
      exports: { "./iocManifest": "./generated/ioc-manifest.ts" },
    }),
  );
  writeFileSync(
    path.join(pkgDir, "generated", "ioc-manifest.ts"),
    libraryManifest(options),
  );

  writeFileSync(path.join(srcDir, "contracts.ts"), APP_CONTRACTS);
  const files = [path.join(srcDir, "contracts.ts")];

  const appFiles: Record<string, string> = {
    "buildApiScope.ts": appScopeRoot("ApiScope", "IApiScope"),
    "buildWorkerScope.ts": appScopeRoot("WorkerScope", "IWorkerScope"),
    "buildAdminScope.ts": appScopeRoot("AdminScope", "IAdminScope"),
    "buildAuditTrail.ts": APP_AUDIT_TRAIL,
  };
  for (const [name, source] of Object.entries(appFiles)) {
    const abs = path.join(factoriesDir, name);
    writeFileSync(abs, source);
    files.push(abs);
  }

  return {
    projectRoot: root,
    files,
    scanDirs: [{ absPath: factoriesDir }],
    packageNames: [LIB],
  };
};

/**
 * Everything the walk needs, resolved ONCE.
 *
 * The TypeScript program, discovery and the composed-manifest load are outside every timed region
 * on purpose: they scale with the fixture too, and folding them in would let their cost mask the
 * thing under measurement. What is timed is the graph walking and nothing else.
 */
const prepare = async (options: LibraryOptions) => {
  const fixture = buildFixture(options);
  const program = ts.createProgram({
    rootNames: fixture.files,
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });

  const generatedDir = path.join(fixture.projectRoot, "src/generated");
  const { contractMap, acceptedFactories, scopeRoots } = discoverFactories(
    fixture.files,
    program,
    fixture.projectRoot,
    "build",
    {
      projectRoot: fixture.projectRoot,
      scanDirs: fixture.scanDirs,
      generatedDir,
    },
    undefined,
    { collectFileRecords: true },
  );

  const plans = buildRegistrationPlan(contractMap, undefined, {
    projectRoot: fixture.projectRoot,
    scanDirs: fixture.scanDirs,
  });

  const composedSupply = await loadComposedManifestSupply(
    fixture.projectRoot,
    fixture.packageNames,
  );

  const ctx = {
    program,
    projectRoot: fixture.projectRoot,
    scanDirs: fixture.scanDirs,
    acceptedFactories,
    plans,
    composedSupply,
    externalKeys: [] as readonly string[],
  };

  /** Verification and exclusion together — every walker generation runs over this graph. */
  const walk = () => {
    const result = verifyScopeRoots(scopeRoots, ctx);
    const exclusion = resolveExternalsExclusion({
      variants: result.variants,
      demandersByKey: demandersFromUnitEdges(acceptedFactories, scopeRoots),
      acceptedFactories,
      scopeRoots,
      supplyIndex: buildScopeRootSupplyIndex(ctx),
    });
    return { result, exclusion };
  };

  return { walk, scopeRoots, composedSupply };
};

/** Minimum of a few runs — the robust statistic for a timing, and the one a loaded runner cannot inflate. */
const fastestOf = (runs: number, body: () => void): number => {
  let best = Infinity;
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    body();
    best = Math.min(best, performance.now() - started);
  }
  return best;
};

/** Distinct units in the graph: the spine plus the members. Nothing is reachable twice. */
const distinctUnits = (members: number): number => LAYERS * WIDTH + members;

describe("scope-root group-hop walks over a shared, deep subtree", () => {
  describe("When a variant's subtree reaches a 30-member group whose members share a deep spine", () => {
    it("should report each unit ONCE, not once per path through it", async () => {
      const { walk } = await prepare({ members: 30 });
      const { result } = walk();

      const api = result.variants.find((v) => v.variantName === "apiScope");
      assert.ok(api, "expected the apiScope variant");

      // The walk really did cross the group hop and descend the whole spine: every distinct unit
      // is present. The variant itself is the extra row.
      assert.equal(api.subtreeUnits.length, distinctUnits(30) + 1);

      // And each of them exactly once. This is the DAG property stated as an assertion: over a
      // graph with ~10^5 distinct root-to-leaf paths, a per-path expansion would put the shared
      // spine units in this list thousands of times over.
      const keys = api.subtreeUnits.map(
        (u) => `${u.modulePath} ${u.exportName}`,
      );
      assert.equal(new Set(keys).size, keys.length);
    });

    it("should complete every walk generation runs, well inside a CI-safe ceiling", async () => {
      const { walk } = await prepare({ members: 30 });

      const ms = fastestOf(3, () => {
        walk();
      });

      // Five seconds against a walk that measures in single-digit milliseconds — a margin of
      // roughly three orders of magnitude. It is sized for the failure CLASS this file exists for
      // (a per-path walk over ~10^5 paths takes minutes, not milliseconds), and it is far too loose
      // to be moved by a slow, shared or throttled CI runner. A tighter bound would buy nothing and
      // would eventually flake.
      assert.ok(
        ms < 5_000,
        `expected the group-hop walks to finish well under 5s, took ${ms.toFixed(1)}ms`,
      );
    });
  });

  describe("When the group grows from 10 members to 30", () => {
    it("should cost a small constant factor more, not an exponential one", async () => {
      const small = await prepare({ members: 10 });
      const large = await prepare({ members: 30 });

      // Repeated, so both measurements sit comfortably above timer resolution; the RATIO is what
      // is asserted, so a uniformly slow machine cancels out.
      const REPEATS = 20;
      const smallMs = fastestOf(3, () => {
        for (let i = 0; i < REPEATS; i += 1) small.walk();
      });
      const largeMs = fastestOf(3, () => {
        for (let i = 0; i < REPEATS; i += 1) large.walk();
      });

      // Tripling the members triples the member-side work and leaves the shared spine untouched,
      // so the honest expectation is a ratio near 3. Ten is the ceiling: generous enough to absorb
      // fixed costs, scheduling noise and a warm-up sample, and orders of magnitude below what a
      // per-path walk would produce (each extra member multiplies the path count).
      const ratio = largeMs / Math.max(smallMs, 0.001);
      assert.ok(
        ratio < 10,
        `expected near-linear growth in member count, got ${ratio.toFixed(1)}x` +
          ` (10 members: ${smallMs.toFixed(1)}ms, 30 members: ${largeMs.toFixed(1)}ms)`,
      );
    });
  });

  describe("When a group member demands the group it belongs to", () => {
    it("should terminate promptly and reach the same verdicts as the acyclic graph", async () => {
      const acyclic = await prepare({ members: 30 });
      const cyclic = await prepare({ members: 30, cycle: true });

      const ms = fastestOf(2, () => {
        cyclic.walk();
      });
      assert.ok(
        ms < 5_000,
        `expected the cycle to terminate promptly, took ${ms.toFixed(1)}ms`,
      );

      // Semantics unchanged: the walk sees the edge, the visited set stops it, and every verdict
      // reads exactly as it does without the cycle. The cycle adds no unit to the subtree, because
      // the group hop it introduces resolves to members the walk has already expanded.
      const verdicts = (prepared: Awaited<ReturnType<typeof prepare>>) => {
        const { result, exclusion } = prepared.walk();
        return {
          variants: result.variants.map((v) => ({
            variantName: v.variantName,
            satisfied: v.satisfied,
            declaredKeys: v.declaredKeys,
            scopeDemands: v.scopeDemands.map((d) => ({
              key: d.key,
              satisfiedBy: d.satisfiedBy,
            })),
            unusedDeclaredKeys: v.unusedDeclaredKeys,
            subtreeUnitCount: v.subtreeUnits.length,
          })),
          errors: result.errors,
          warnings: result.warnings,
          excludedKeys: [...exclusion.excludedKeys].sort(),
          sharedSubtreeUnits: exclusion.sharedSubtreeUnits,
        };
      };

      assert.deepEqual(verdicts(cyclic), verdicts(acyclic));
    });
  });
});
