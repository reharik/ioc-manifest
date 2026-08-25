/**
 * @fileoverview The pin on the CLI-to-API move: same bytes, same skips.
 *
 * Generation used to format each emitted file by spawning `node prettier.cjs --write <file>`. It
 * now calls prettier in-process. That is only a performance change if the output is the same
 * character for character, and prettier's CLI is not a thin wrapper around `format()` — it resolves
 * configuration and ignore rules first, with different defaults from the API's.
 *
 * So this file runs BOTH: the real CLI, from the same resolved prettier, over one copy; and
 * {@link formatGeneratedFileWithPrettier} over an identical copy. The subject is the diff between
 * them, which is why the CLI half is a real subprocess rather than something faster — it is the
 * thing being compared against, and a reimplementation of it would prove nothing.
 *
 * The inputs are the repository's own emitted artifacts, whitespace-mangled so that formatting has
 * work to do: a comparison over already-formatted text would pass with both halves doing nothing.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { formatGeneratedFileWithPrettier } from "./formatGeneratedFile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const require = createRequire(import.meta.url);

/** The very CLI the old code path invoked, resolved the very same way. */
const prettierCli = path.join(
  path.dirname(require.resolve("prettier/package.json")),
  "bin",
  "prettier.cjs",
);

/**
 * Real emitted output, not a hand-written sample: the artifacts this function exists to format.
 */
const ARTIFACTS = ["ioc-manifest.ts", "ioc-registry.types.ts"] as const;

/**
 * Whitespace the emitter would never produce, so both halves have something to normalise.
 *
 * Only whitespace — the text must stay parseable TypeScript, since a syntax error would make both
 * halves fail identically and the comparison vacuous.
 */
const mangle = (source: string): string =>
  source.replace(/\n\n/g, "\n\n\n").replace(/, /g, ",  ");

type Project = { readonly root: string; readonly generatedDir: string };

const project = (files: Record<string, string>): Project => {
  const root = mkdtempSync(path.join(tmpdir(), "ioc-prettier-"));
  const generatedDir = path.join(root, "src", "generated");
  mkdirSync(generatedDir, { recursive: true });
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "@fixture/prettier", type: "module" }),
  );
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(root, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents, "utf8");
  }
  return { root, generatedDir };
};

/** `prettier --write <file>`, with the working directory generation used to pass. */
const formatViaCli = (filePath: string, projectRoot: string): void => {
  execFileSync(process.execPath, [prettierCli, "--write", filePath], {
    cwd: projectRoot,
    stdio: "pipe",
    env: process.env,
  });
};

/**
 * Formats one mangled artifact both ways inside `extraFiles`-shaped project, and returns the two
 * results for comparison.
 */
const bothWays = async (
  artifact: string,
  extraFiles: Record<string, string> = {},
): Promise<{ cli: string; api: string; input: string }> => {
  const input = mangle(
    readFileSync(path.join(repoRoot, "src", "generated", artifact), "utf8"),
  );
  const cliName = path.join("src", "generated", `cli-${artifact}`);
  const apiName = path.join("src", "generated", `api-${artifact}`);
  const { root } = project({
    ...extraFiles,
    [cliName]: input,
    [apiName]: input,
  });

  formatViaCli(path.join(root, cliName), root);
  await formatGeneratedFileWithPrettier(path.join(root, apiName), root);

  return {
    cli: readFileSync(path.join(root, cliName), "utf8"),
    api: readFileSync(path.join(root, apiName), "utf8"),
    input,
  };
};

describe("formatting generated files through prettier's API", () => {
  describe("When a generated artifact is formatted", () => {
    for (const artifact of ARTIFACTS) {
      it(`should produce byte-identical text to \`prettier --write\` for ${artifact}`, async () => {
        const { cli, api, input } = await bothWays(artifact);

        assert.notEqual(
          cli,
          input,
          "the fixture was already formatted — the comparison would prove nothing",
        );
        assert.equal(api, cli);
      });
    }
  });

  describe("When the project has an .editorconfig and no prettier config", () => {
    it("should honour it, exactly as the CLI does", async () => {
      // The CLI reads `.editorconfig`; `resolveConfig` does not unless asked. Without the ask, a
      // project pinned to eight-space indent would silently get two-space artifacts.
      const { cli, api } = await bothWays("ioc-manifest.ts", {
        ".editorconfig": "root = true\n\n[*]\nindent_style = space\nindent_size = 8\n",
      });

      assert.match(api, /^ {8}\S/m, "the editorconfig indent should have been applied");
      assert.equal(api, cli);
    });
  });

  describe("When the generated directory is ignored by .gitignore", () => {
    it("should leave the file alone, exactly as the CLI does", async () => {
      // Prettier 3's CLI skips an ignored path even when it is named explicitly, and a generated
      // directory is very often gitignored. Formatting it here would be a behaviour change dressed
      // as a speed-up.
      const { cli, api, input } = await bothWays("ioc-manifest.ts", {
        ".gitignore": "src/generated/\n",
      });

      assert.equal(cli, input, "the CLI should have skipped the ignored file");
      assert.equal(api, input);
    });
  });

  describe("When the same file is formatted twice", () => {
    it("should be a no-op the second time", async () => {
      const artifact = "ioc-registry.types.ts";
      const name = path.join("src", "generated", artifact);
      const input = mangle(
        readFileSync(path.join(repoRoot, "src", "generated", artifact), "utf8"),
      );
      const { root } = project({ [name]: input });
      const target = path.join(root, name);

      await formatGeneratedFileWithPrettier(target, root);
      const once = readFileSync(target, "utf8");
      await formatGeneratedFileWithPrettier(target, root);

      assert.notEqual(once, input);
      assert.equal(readFileSync(target, "utf8"), once);
    });
  });

  describe("When the file cannot be formatted", () => {
    it("should warn rather than fail the generation", async () => {
      // Prettier is an optional peer and formatting is cosmetic; a generation that got as far as
      // writing its artifacts must not be failed by the tidying afterwards.
      const { root } = project({
        "src/generated/broken.ts": "export const = ;;;\n",
      });
      const warnings: string[] = [];
      const realWarn = console.warn;
      console.warn = (...args: unknown[]): void => {
        warnings.push(args.join(" "));
      };
      try {
        await formatGeneratedFileWithPrettier(
          path.join(root, "src", "generated", "broken.ts"),
          root,
        );
      } finally {
        console.warn = realWarn;
      }

      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /^Failed to format generated files: /);
      assert.equal(
        readFileSync(path.join(root, "src", "generated", "broken.ts"), "utf8"),
        "export const = ;;;\n",
      );
    });
  });
});
