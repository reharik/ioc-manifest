/**
 * @fileoverview Formats emitted artifacts through prettier's Node API rather than its CLI.
 *
 * Every generation writes two or three files, and each one used to cost a `node bin/prettier.cjs
 * --write <file>` subprocess: a cold Node boot plus a cold parse of prettier's ~4MB bundle, per
 * file, measured here at 350–550ms each. In-process the bundle is loaded once per generation
 * process and each file costs 45–70ms. Production pays that difference on every `ioc generate`, and
 * the test suite pays it once per fixture generation.
 *
 * The point of this module is that the SAVING is the only thing that changes. Prettier's CLI is not
 * a thin wrapper around `format()` — it resolves configuration and ignore rules first, and the
 * defaults of the two surfaces differ in two ways that would silently reformat a consumer's
 * artifacts:
 *
 *  - **`.editorconfig`.** The CLI reads it; `resolveConfig` does NOT unless asked. A project with
 *    `indent_size = 8` and no `.prettierrc` got 8-space artifacts from the CLI and would have got
 *    2-space ones from a naive API port. Hence `{ editorconfig: true }`.
 *  - **Ignore files.** Prettier 3's CLI skips a file matched by `.gitignore` or `.prettierignore`
 *    EVEN WHEN the path is passed explicitly — and a generated directory is very often gitignored,
 *    so for many consumers the CLI has been formatting nothing at all while still paying for the
 *    spawn. Reproducing that through `getFileInfo` is what keeps this a pure performance change
 *    rather than "generated files are now formatted where they previously were not".
 *
 * Both defaults are pinned by `formatGeneratedFile.test.ts`, which formats the same source through
 * the CLI and through this module and asserts the two byte-for-byte.
 *
 * Prettier remains an OPTIONAL peer dependency: if it does not resolve, generation succeeds and the
 * files are simply unformatted, exactly as before.
 */
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

/**
 * The slice of prettier's surface this uses.
 *
 * Structural rather than imported from `prettier`'s own types: the dependency is optional, and a
 * `import type { ... } from "prettier"` in a consumer that has not installed it is a type error in
 * their build, not ours.
 */
type PrettierApi = {
  format(
    source: string,
    options: Record<string, unknown>,
  ): Promise<string>;
  resolveConfig(
    filePath: string,
    options?: { editorconfig?: boolean },
  ): Promise<Record<string, unknown> | null>;
  getFileInfo(
    filePath: string,
    options?: { ignorePath?: readonly string[]; resolveConfig?: boolean },
  ): Promise<{ ignored: boolean; inferredParser: string | null }>;
};

/**
 * Loaded once per process, resolved from THIS module — the same resolution the CLI path used, so a
 * consumer with a hoisted prettier and one with a nested one both keep the prettier they had.
 *
 * The promise is cached rather than the module, so concurrent generations in one process share a
 * single load, and a failure to resolve is cached as `undefined` rather than retried per file.
 */
let prettierApi: Promise<PrettierApi | undefined> | undefined;

const loadPrettier = (): Promise<PrettierApi | undefined> => {
  prettierApi ??= (async (): Promise<PrettierApi | undefined> => {
    let entry: string;
    try {
      entry = require.resolve("prettier");
    } catch {
      return undefined;
    }
    try {
      // Prettier's published entry point is a CommonJS bundle whose named exports Node's lexer does
      // not detect, so the namespace object is empty and everything hangs off `default`.
      const mod = (await import(pathToFileURL(entry).href)) as {
        default?: PrettierApi;
      } & Partial<PrettierApi>;
      return (mod.default ?? (mod as PrettierApi)) satisfies PrettierApi;
    } catch {
      return undefined;
    }
  })();
  return prettierApi;
};

/**
 * The ignore files prettier's CLI consults by default, resolved the way the CLI resolved them.
 *
 * The CLI took `cwd: projectRoot`, and its default `--ignore-path` is `.gitignore` plus
 * `.prettierignore` relative to that cwd. Neither has to exist.
 */
const ignorePathsFor = (projectRoot: string): readonly string[] => [
  path.join(projectRoot, ".gitignore"),
  path.join(projectRoot, ".prettierignore"),
];

/**
 * Format one emitted file in place via the consumer's `prettier`, when there is one.
 *
 * Never throws: a formatting failure is cosmetic, and generation has already done the work that
 * matters. The warning is the same one the CLI path printed.
 */
export const formatGeneratedFileWithPrettier = async (
  filePath: string,
  projectRoot: string,
): Promise<void> => {
  const prettier = await loadPrettier();
  if (prettier === undefined) {
    return;
  }

  try {
    const info = await prettier.getFileInfo(filePath, {
      ignorePath: ignorePathsFor(projectRoot),
      resolveConfig: false,
    });
    if (info.ignored || info.inferredParser === null) {
      return;
    }

    const config = await prettier.resolveConfig(filePath, {
      editorconfig: true,
    });
    const source = await fs.readFile(filePath, "utf8");
    const formatted = await prettier.format(source, {
      ...(config ?? {}),
      filepath: filePath,
    });
    // `--write` leaves an already-formatted file untouched; so does this.
    if (formatted !== source) {
      await fs.writeFile(filePath, formatted, "utf8");
    }
  } catch (error) {
    console.warn(
      `Failed to format generated files: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
