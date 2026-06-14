import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const tscBin = path.join(
  path.dirname(require.resolve("typescript/package.json")),
  "bin",
  "tsc",
);

const runTsc = (root: string, source: string): "pass" | "fail" => {
  writeFileSync(path.join(root, "src", "ioc-composed.ts"), source);
  try {
    execFileSync(process.execPath, [tscBin, "-p", root], {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
    });
    return "pass";
  } catch {
    return "fail";
  }
};

const buildFixtureRoot = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), "ioc-ext-"));
  const srcDir = path.join(root, "src");
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "ES2022",
          module: "ES2022",
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
  );
  return root;
};

const buildPerKeyAssertions = (
  cap: string,
  externalsName: string,
  keys: readonly string[],
): string => {
  const pickAlias = `_${cap}ExternalsPick`;
  const lines = [
    `type ${pickAlias} = Pick<AppCradle, keyof ${externalsName}>;`,
    ...keys.flatMap((key) => {
      const suffix = key.replace(/[^\w$]/g, "_");
      return [
        `type _${cap}_${suffix} = ${externalsName}[${JSON.stringify(key)}] extends ${pickAlias}[${JSON.stringify(key)}] ? true : false;`,
        `type _${cap}_${suffix}Assert = _IocExpect<_${cap}_${suffix}>;`,
      ];
    }),
  ];
  return lines.join("\n");
};

const buildBulkAssertion = (externalsName: string): string =>
  `type _${externalsName}Bulk = ${externalsName} extends Pick<AppCradle, keyof ${externalsName}> ? true : false;
type _${externalsName}BulkAssert = _IocExpect<_${externalsName}Bulk>;`;

describe("composed externals satisfaction assertion", () => {
  describe("When AppCradle does not supply a composed package external", () => {
    it("should fail tsc at the per-key satisfaction assertion", () => {
      const root = buildFixtureRoot();
      const source = `export type AppCradle = { appOnly: string };
export interface LibExternals { database: unknown; }
type _IocExpect<T extends true> = T;
${buildPerKeyAssertions("Lib", "LibExternals", ["database"])}
`;

      assert.equal(runTsc(root, source), "fail");
    });
  });

  describe("When optional external keys are declared", () => {
    const scenarios = [
      {
        name: "optional top-level key omitted from AppCradle",
        appCradle: "{ config: { logLevel: string } }",
        externals:
          "{ config: { logLevel: string }; logJsonFilePath?: string }",
        keys: ["config", "logJsonFilePath"] as const,
      },
      {
        name: "optional top-level key supplied with matching type",
        appCradle:
          "{ config: { logLevel: string }; logJsonFilePath?: string }",
        externals:
          "{ config: { logLevel: string }; logJsonFilePath?: string }",
        keys: ["config", "logJsonFilePath"] as const,
      },
      {
        name: "nested optional field with union mismatch on config",
        appCradle: "{ config: { logLevel: 'error' | 'warn' } }",
        externals:
          "{ config: { logLevel: string; logJsonFilePath?: string } }",
        keys: ["config"] as const,
      },
      {
        name: "optional top-level key supplied with wrong type",
        appCradle: "{ config: { logLevel: string }; logJsonFilePath: number }",
        externals:
          "{ config: { logLevel: string }; logJsonFilePath?: string }",
        keys: ["config", "logJsonFilePath"] as const,
      },
    ] as const;

    for (const scenario of scenarios) {
      describe(`When ${scenario.name}`, () => {
        it("should match bulk pass/fail with per-key Pick-indexed assertions", () => {
          const root = buildFixtureRoot();
          const header = `export type AppCradle = ${scenario.appCradle};
export interface PkgExternals ${scenario.externals}
type _IocExpect<T extends true> = T;`;

          const bulkSource = `${header}
${buildBulkAssertion("PkgExternals")}`;
          const perKeySource = `${header}
${buildPerKeyAssertions("Pkg", "PkgExternals", scenario.keys)}`;

          const bulkResult = runTsc(root, bulkSource);
          const perKeyResult = runTsc(root, perKeySource);

          assert.equal(
            perKeyResult,
            bulkResult,
            `expected per-key ${perKeyResult} to match bulk ${bulkResult} for ${scenario.name}`,
          );
        });
      });
    }
  });
});
