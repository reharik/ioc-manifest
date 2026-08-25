/**
 * @fileoverview What puts a test file in the slow lane, decided by mechanism rather than by name.
 *
 * `npm run test:fast` is the non-`.integration` glob and `npm test` is everything. That split is
 * only worth having if the suffix keeps telling the truth, and the previous attempt at the same
 * idea — a hand-maintained list of "the slow ones" — decayed the moment someone added a test
 * without reading it. A suffix decays the same way: `generatedReferenceForms.test.ts` built
 * TypeScript programs for 18 seconds — the slowest file in the repo — under a name that promised it
 * did not, while `generatedTypes.integration.test.ts` read one file in 0.3s under a name that said
 * it was expensive.
 *
 * So the suffix is not the source of truth here; the value-import graph is. This module answers one
 * question about one file — *can it do integration work?* — and `testLaneSeam.test.ts` asks it of
 * every test file in both directions: a `.integration` file that cannot, and a fast-lane file that
 * can, are both failures.
 *
 * ## The three mechanisms
 *
 * Everything that made the slow lane slow does one of three things, and each is visible without
 * running anything:
 *
 *  1. **Builds a TypeScript program.** `ts.createProgram` and its siblings parse and bind a real
 *     program; that is the seconds. Detected as a CALL in the AST, so `typescript` appearing in a
 *     comment, a string, or a type-only import is not a hit — and it must not be, because this very
 *     module imports `typescript` to do the detecting and belongs in the fast lane.
 *  2. **Spawns a subprocess.** A value import of `child_process`; ~222ms of `tsx` boot per spawn.
 *  3. **Runs codegen.** {@link CODEGEN_ENTRY} — the first two plus the whole analysis.
 *
 * A file counts as doing one of these if it does it itself, or if any module it can reach through
 * value imports does. Type-only imports are erased before anything runs and are not edges.
 *
 * ## Why reachability, and not the direct imports alone
 *
 * The narrower rule — judge a file on its own calls and the modules it names — was tried first and
 * is wrong in the direction that matters. `discoveryComposedConfig.integration.test.ts` imports
 * `runDiscoveryAnalysis`, which is several modules away from `ts.createProgram` and spends three
 * seconds there; the direct rule pronounced that file fast-lane material and would have moved a
 * real program build into the lane this guard exists to keep clean.
 *
 * Reachability over-approximates instead: a module may import a heavy neighbour and never call
 * into it, and `freshnessTraversal` — which wants a glob helper that happens to live beside the
 * program bootstrap — is judged heavy on that basis. That is the safe direction. A false "this is
 * heavy" costs one rename; a missed one costs the lane. And the two verdicts do not in fact
 * disagree with the clock here: under this rule every fast-lane file runs in ≤1.1s and every file
 * it excludes runs in ≥1.0s, which is about as clean as a cut over 112 files gets.
 *
 * ## Why static, and not an instrumented timing run
 *
 * A wall-time threshold measures the thing we actually care about, and is the one detection that
 * cannot be fooled — but it flakes. Identical trees here have run the same suite in 127s and in
 * 349s under load, and a guard whose verdict moves with the machine's mood is a guard people turn
 * off. This rule is a pure function of the source text: same tree, same answer, on any machine,
 * with no clock in it.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/** The codegen entry, relative to the `src` root. Importing it means running a full generation. */
export const CODEGEN_ENTRY = path.join("generator", "generateManifest.ts");

/** TypeScript's program-building entry points — the calls that cost seconds. */
const PROGRAM_BUILDERS: ReadonlySet<string> = new Set([
  "createProgram",
  "createIncrementalProgram",
  "createWatchProgram",
  "createSolutionBuilder",
]);

const isSubprocessModule = (specifier: string): boolean =>
  specifier === "child_process" || specifier === "node:child_process";

const parse = (file: string): ts.SourceFile =>
  ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ false,
    ts.ScriptKind.TS,
  );

/**
 * The module specifiers this file imports FOR A VALUE.
 *
 * Type-only imports are erased before anything runs, so a `import type ts from "typescript"` costs
 * nothing and must not be counted. Side-effect imports (`import "./x.js"`) are counted: they run.
 */
const valueImportSpecifiers = (source: ts.SourceFile): readonly string[] => {
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      // `isTypeOnly` over TS 5.8's `phaseModifier`: `typescript` is a `^5.0.0` peer here, and the
      // newer spelling does not exist across that whole range.
      const isValue =
        clause === undefined ||
        (!clause.isTypeOnly &&
          (clause.name !== undefined ||
            (bindings !== undefined && ts.isNamespaceImport(bindings)) ||
            (bindings !== undefined &&
              ts.isNamedImports(bindings) &&
              bindings.elements.some((element) => !element.isTypeOnly))));
      if (isValue) {
        specifiers.push(node.moduleSpecifier.text);
      }
      return;
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.isTypeOnly
    ) {
      specifiers.push(node.moduleSpecifier.text);
      return;
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const argument = node.arguments[0];
      if (argument !== undefined && ts.isStringLiteral(argument)) {
        specifiers.push(argument.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return specifiers;
};

/** Does this file CALL a TypeScript program-building entry point? */
const callsProgramBuilder = (source: ts.SourceFile): boolean => {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) {
      return;
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : undefined;
      if (name !== undefined && PROGRAM_BUILDERS.has(name)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return found;
};

/**
 * Resolves a relative specifier written in ESM style (`./x.js`) to the `.ts` file on disk.
 *
 * Bare specifiers are deliberately NOT resolved: what matters about `typescript` or
 * `child_process` is the specifier itself, and walking into `node_modules` would turn a syntax
 * check into a dependency crawl.
 */
const resolveLocal = (fromFile: string, specifier: string): string | undefined => {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const base = path.resolve(path.dirname(fromFile), specifier);
  const withoutJs = base.replace(/\.js$/, "");
  for (const candidate of [
    `${withoutJs}.ts`,
    `${withoutJs}.tsx`,
    path.join(withoutJs, "index.ts"),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return undefined;
};

/** Every `.ts` file under `dir`, `node_modules` pruned. */
const walk = (dir: string): readonly string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" ? [] : walk(full);
    }
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")
      ? [full]
      : [];
  });

export type TestLaneFiles = {
  /** Absolute paths, sorted: everything `npm run test:fast` runs. */
  readonly fast: readonly string[];
  /** Absolute paths, sorted: everything only `npm test` runs. */
  readonly integration: readonly string[];
};

const INTEGRATION_SUFFIX = ".integration.test.ts";

/** The two lanes as the globs in `package.json` define them — by suffix, and by suffix only. */
export const collectTestFiles = (srcRoot: string): TestLaneFiles => {
  const tests = walk(srcRoot)
    .filter((file) => file.endsWith(".test.ts"))
    .sort();
  return {
    fast: tests.filter((file) => !file.endsWith(INTEGRATION_SUFFIX)),
    integration: tests.filter((file) => file.endsWith(INTEGRATION_SUFFIX)),
  };
};

/** What a module does itself, ignoring anything it imports. */
type OwnMechanism = "program" | "subprocess" | "codegen";

const describeMechanism: Record<OwnMechanism, string> = {
  program: "builds a TypeScript program",
  subprocess: "spawns a subprocess",
  codegen: "runs codegen",
};

/**
 * What this module does ITSELF — the leaves of the search below.
 *
 * The cheap text test is a pre-filter only; the AST decides, so a file that merely mentions
 * `createProgram` in prose is not a leaf. The codegen entry is named by path because after the
 * prettier CLI became an in-process call it no longer spawns anything, and "runs a whole
 * generation" is a cost in its own right whatever it is implemented with.
 */
const ownMechanismOf = (
  file: string,
  srcRoot: string,
): OwnMechanism | undefined => {
  if (path.relative(srcRoot, file) === CODEGEN_ENTRY) {
    return "codegen";
  }
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes("child_process") && !text.includes("Program(")) {
    return undefined;
  }
  const source = parse(file);
  if (callsProgramBuilder(source)) {
    return "program";
  }
  return valueImportSpecifiers(source).some(isSubprocessModule)
    ? "subprocess"
    : undefined;
};

type Graph = {
  readonly own: ReadonlyMap<string, OwnMechanism>;
  readonly edges: ReadonlyMap<string, readonly string[]>;
};

/**
 * The value-import graph over `src`, with each module's own mechanism attached.
 *
 * Built once per root and cached: the guard asks about every test file in the repo, and reparsing
 * ~240 modules per question would make the guard the slowest thing in the lane it protects.
 */
const buildGraph = (srcRoot: string): Graph => {
  const own = new Map<string, OwnMechanism>();
  const edges = new Map<string, readonly string[]>();
  for (const file of walk(srcRoot)) {
    const mechanism = ownMechanismOf(file, srcRoot);
    if (mechanism !== undefined) {
      own.set(file, mechanism);
    }
    edges.set(
      file,
      valueImportSpecifiers(parse(file))
        .map((specifier) => resolveLocal(file, specifier))
        .filter((resolved): resolved is string => resolved !== undefined),
    );
  }
  return { own, edges };
};

let graphCache: { root: string; graph: Graph } | undefined;

const graphFor = (srcRoot: string): Graph => {
  if (graphCache?.root !== srcRoot) {
    graphCache = { root: srcRoot, graph: buildGraph(srcRoot) };
  }
  return graphCache.graph;
};

/**
 * The nearest module reachable from `file` that does `mechanism`, or undefined.
 *
 * Breadth-first so the path named in a failure is the shortest one, which is the one a reader can
 * act on. Cycles are ordinary in this graph and are handled by the visited set, not by a depth cap.
 */
const nearestWith = (
  graph: Graph,
  file: string,
  mechanism: OwnMechanism,
): string | undefined => {
  const seen = new Set<string>([file]);
  let frontier = [file];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const current of frontier) {
      if (graph.own.get(current) === mechanism) {
        return current;
      }
      for (const edge of graph.edges.get(current) ?? []) {
        if (!seen.has(edge)) {
          seen.add(edge);
          next.push(edge);
        }
      }
    }
    frontier = next;
  }
  return undefined;
};

/**
 * Why this file belongs in the slow lane, in the words a failure message should use.
 *
 * Empty means the file cannot build a TypeScript program, cannot spawn a subprocess and cannot run
 * codegen — which is exactly the fast lane's definition.
 *
 * Reachability, not the direct imports alone: `discoveryComposedConfig.integration.test.ts` imports
 * `runDiscoveryAnalysis`, which is four modules away from `ts.createProgram`, and spends three
 * seconds there. A direct-imports rule called that file fast-lane material and would have moved a
 * real program build into the lane it exists to keep clean. So the question asked here is CAN this
 * file reach the mechanism, which over-approximates — a module may import a heavy neighbour and
 * never call into it — and over-approximating is the safe direction: it costs a rename, where
 * under-approximating costs the lane.
 */
export const integrationMechanismsOf = (
  file: string,
  srcRoot: string,
): readonly string[] => {
  const graph = graphFor(srcRoot);
  const reasons: string[] = [];
  for (const mechanism of ["program", "subprocess", "codegen"] as const) {
    const via = nearestWith(graph, file, mechanism);
    if (via === undefined) {
      continue;
    }
    reasons.push(
      via === file
        ? describeMechanism[mechanism]
        : `${describeMechanism[mechanism]}, via ${path.relative(srcRoot, via)}`,
    );
  }
  return reasons;
};
