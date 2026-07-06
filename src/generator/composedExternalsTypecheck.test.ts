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
        `type _${cap}_${suffix} = ${pickAlias}[${JSON.stringify(key)}] extends ${externalsName}[${JSON.stringify(key)}] ? true : false;`,
        `type _${cap}_${suffix}Assert = _IocExpect<_${cap}_${suffix}>;`,
      ];
    }),
  ];
  return lines.join("\n");
};

const buildBulkAssertion = (externalsName: string): string =>
  `type _${externalsName}Bulk = Pick<AppCradle, keyof ${externalsName}> extends ${externalsName} ? true : false;
type _${externalsName}BulkAssert = _IocExpect<_${externalsName}Bulk>;`;

type ExternalsScenario = {
  readonly name: string;
  readonly appCradle: string;
  readonly externals: string;
  readonly keys: readonly string[];
  readonly expected: "pass" | "fail";
};

const satisfactionMatrix: readonly ExternalsScenario[] = [
  {
    name: "exact Logger match",
    appCradle: "{ logger: Logger }",
    externals: "{ logger: Logger }",
    keys: ["logger"],
    expected: "pass",
  },
  {
    name: "supplied superset satisfies demanded slice",
    appCradle: "{ config: { a: string; b: number } }",
    externals: "{ config: { a: string } }",
    keys: ["config"],
    expected: "pass",
  },
  {
    name: "under-supplied object rejects",
    appCradle: "{ config: { a: string } }",
    externals: "{ config: { a: string; b: number } }",
    keys: ["config"],
    expected: "fail",
  },
  {
    name: "optional demanded key accepts required supply",
    appCradle: "{ item: { x: string } }",
    externals: "{ item: { x?: string } }",
    keys: ["item"],
    expected: "pass",
  },
  {
    name: "required demanded key rejects optional supply",
    appCradle: "{ item: { x?: string } }",
    externals: "{ item: { x: string } }",
    keys: ["item"],
    expected: "fail",
  },
  {
    name: "narrower union supply satisfies wider string demand",
    appCradle: "{ level: 'a' | 'b' }",
    externals: "{ level: string }",
    keys: ["level"],
    expected: "pass",
  },
  {
    name: "wider string supply rejects narrower union demand",
    appCradle: "{ level: string }",
    externals: "{ level: 'a' | 'b' }",
    keys: ["level"],
    expected: "fail",
  },
  {
    name: "nested config slice with extra supplied fields",
    appCradle:
      "{ config: { logLevel: 'a' | 'b'; log?: string; nodeEnv: string; port: number } }",
    externals: "{ config: { logLevel: 'a' | 'b'; log?: string } }",
    keys: ["config"],
    expected: "pass",
  },
];

const scenarioHeader = (scenario: ExternalsScenario): string =>
  `export type Logger = { log: (msg: string) => void };
export type AppCradle = ${scenario.appCradle};
export interface PkgExternals ${scenario.externals}
type _IocExpect<T extends true> = T;`;

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Each scenario source is written to its OWN file in one shared fixture root so a
// single tsc pass over the root can type-check them all together. Because every
// file uses `export`, each is an isolated module scope — top-level names never
// collide and a type error in one file cannot mask errors in another. tsc reports
// diagnostics for all files, so we map each diagnostic's file back to its scenario.
const root = buildFixtureRoot();
const srcDir = path.join(root, "src");

const writeScenarioFile = (slug: string, source: string): string => {
  const fileName = `${slug}.ts`;
  writeFileSync(path.join(srcDir, fileName), source);
  return fileName;
};

const noSupplyFile = writeScenarioFile(
  "no-supply",
  `export type AppCradle = { appOnly: string };
export interface LibExternals { database: unknown; }
type _IocExpect<T extends true> = T;
${buildPerKeyAssertions("Lib", "LibExternals", ["database"])}
`,
);

const perKeyFiles = new Map<string, string>();
const bulkFiles = new Map<string, string>();
for (const scenario of satisfactionMatrix) {
  const slug = slugify(scenario.name);
  const header = scenarioHeader(scenario);
  perKeyFiles.set(
    scenario.name,
    writeScenarioFile(
      `${slug}-perkey`,
      `${header}
${buildPerKeyAssertions("Pkg", "PkgExternals", scenario.keys)}`,
    ),
  );
  bulkFiles.set(
    scenario.name,
    writeScenarioFile(
      `${slug}-bulk`,
      `${header}
${buildBulkAssertion("PkgExternals")}`,
    ),
  );
}

// Run tsc ONCE over the whole fixture root. execFileSync throws on a non-zero exit
// (any diagnostics), so capture the output either way rather than letting it throw.
const runTscOnce = (): Set<string> => {
  let output = "";
  try {
    execFileSync(process.execPath, [tscBin, "-p", root], {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  const failed = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^(.+?\.ts)\(\d+,\d+\): error/.exec(line);
    if (match) failed.add(path.basename(match[1]));
  }
  return failed;
};

const failedFiles = runTscOnce();
const resultFor = (fileName: string): "pass" | "fail" =>
  failedFiles.has(fileName) ? "fail" : "pass";

describe("composed externals satisfaction assertion", () => {
  describe("When AppCradle does not supply a composed package external", () => {
    it("should fail tsc at the per-key satisfaction assertion", () => {
      assert.equal(resultFor(noSupplyFile), "fail");
    });
  });

  for (const scenario of satisfactionMatrix) {
    describe(`When ${scenario.name}`, () => {
      it(`should ${scenario.expected} per-key assertions (supplied extends demanded)`, () => {
        assert.equal(
          resultFor(perKeyFiles.get(scenario.name)!),
          scenario.expected,
          `per-key assertion for ${scenario.name}`,
        );
      });

      it(`should ${scenario.expected} corrected bulk Pick extends Externals`, () => {
        assert.equal(
          resultFor(bulkFiles.get(scenario.name)!),
          scenario.expected,
          `bulk assertion for ${scenario.name}`,
        );
      });

      it("should agree between per-key and corrected bulk assertions", () => {
        const bulkResult = resultFor(bulkFiles.get(scenario.name)!);
        const perKeyResult = resultFor(perKeyFiles.get(scenario.name)!);

        assert.equal(
          perKeyResult,
          bulkResult,
          `expected per-key ${perKeyResult} to match bulk ${bulkResult} for ${scenario.name}`,
        );
        assert.equal(
          perKeyResult,
          scenario.expected,
          `expected ${scenario.expected} for ${scenario.name}`,
        );
      });
    });
  }
});
