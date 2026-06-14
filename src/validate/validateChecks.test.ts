import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { IocConfig } from "../config/iocConfig.js";
import { MANIFEST_SCHEMA_VERSION } from "../schemaVersion.js";
import {
  manifestSource,
  parsedSlice,
  typesSource,
  validateContext,
} from "../test-support/manifestFixtures.js";
import { checkAppConfigSanity } from "./checks/appConfig.js";
import { checkDefaultAmbiguity } from "./checks/defaultAmbiguity.js";
import { checkExternalsSatisfaction, CHECKER_UNAVAILABLE_CAVEAT } from "./checks/externals.js";
import { checkGroupConsistency } from "./checks/groups.js";
import { checkSameKeyConflicts } from "./checks/sameKeyConflict.js";
import { checkSchemaVersions } from "./checks/schemaVersion.js";
import { runAllValidationChecks } from "./runValidate.js";

describe("validate checks", () => {
  describe("checkExternalsSatisfaction", () => {
    describe("When a composed package external is not in any cradle", () => {
      it("should report an externals error", () => {
        const ctx = validateContext([
          parsedSlice({
            packageLabel: "local",
            cradleKeys: new Set(["appOnly"]),
            externals: {},
          }),
          parsedSlice({
            packageLabel: "@lib/a",
            sourceId: "@lib/a",
            cradleKeys: new Set(["svc"]),
            externals: { logger: { typeText: "Logger" } },
          }),
        ]);
        const issues = checkExternalsSatisfaction(ctx);
        assert.equal(issues.length, 1);
        assert.equal(issues[0]!.category, "externals");
        assert.match(issues[0]!.summary, /Unsatisfied.*logger/);
        assert.match(issues[0]!.details.join("\n"), /No manifest in composedManifests supplies/);
      });
    });

    describe("When all externals are supplied in a cradle", () => {
      it("should report no issues", () => {
        const root = mkdtempSync(path.join(tmpdir(), "ioc-validate-ext-ok-"));
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
            },
            null,
            2,
          ),
        );
        const localTypesPath = path.join(root, "local.types.ts");
        const libTypesPath = path.join(root, "lib.types.ts");
        writeFileSync(
          localTypesPath,
          typesSource("logger: { log: (msg: string) => void }", ""),
        );
        writeFileSync(
          libTypesPath,
          typesSource("", "logger: { log: (msg: string) => void }"),
        );

        const ctx = validateContext([
          parsedSlice({
            packageLabel: "local",
            typesPath: localTypesPath,
            cradleKeys: new Set(["logger"]),
            cradleTypes: {
              logger: { typeText: "{ log: (msg: string) => void }" },
            },
          }),
          parsedSlice({
            packageLabel: "@lib/a",
            sourceId: "@lib/a",
            typesPath: libTypesPath,
            externals: {
              logger: { typeText: "{ log: (msg: string) => void }" },
            },
          }),
        ]);

        assert.equal(
          checkExternalsSatisfaction({ ...ctx, projectRoot: root }).length,
          0,
        );
      });
    });

    describe("When supplied type is a superset of demanded external type", () => {
      it("should report no issues (supplied extends demanded)", () => {
        const root = mkdtempSync(path.join(tmpdir(), "ioc-validate-ext-superset-"));
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
            },
            null,
            2,
          ),
        );
        const localTypesPath = path.join(root, "local.types.ts");
        const libTypesPath = path.join(root, "lib.types.ts");
        writeFileSync(
          localTypesPath,
          typesSource(`config: { logLevel: "error" | "warn" | "info" }`, ""),
        );
        writeFileSync(
          libTypesPath,
          typesSource("", `config: { logLevel: string }`),
        );

        const ctx = validateContext([
          parsedSlice({
            packageLabel: "@apps/api",
            sourceId: "local",
            typesPath: localTypesPath,
            cradleKeys: new Set(["config"]),
            cradleTypes: {
              config: { typeText: '{ logLevel: "error" | "warn" | "info" }' },
            },
          }),
          parsedSlice({
            packageLabel: "@packages/infrastructure",
            sourceId: "@packages/infrastructure",
            typesPath: libTypesPath,
            externals: {
              config: { typeText: "{ logLevel: string }" },
            },
          }),
        ]);

        assert.equal(
          checkExternalsSatisfaction({ ...ctx, projectRoot: root }).length,
          0,
        );
      });
    });

    describe("When a supplied external key has an incompatible type", () => {
      it("should report a type mismatch with demanded and supplied types", () => {
        const root = mkdtempSync(path.join(tmpdir(), "ioc-validate-ext-"));
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
            },
            null,
            2,
          ),
        );
        const localTypesPath = path.join(root, "local.types.ts");
        const libTypesPath = path.join(root, "lib.types.ts");
        writeFileSync(
          localTypesPath,
          typesSource(`config: { logLevel: string }`, ""),
        );
        writeFileSync(
          libTypesPath,
          typesSource("", `config: { logLevel: "error" | "warn" | "info" }`),
        );

        const ctx = validateContext([
          parsedSlice({
            packageLabel: "@apps/api",
            sourceId: "local",
            typesPath: localTypesPath,
            cradleKeys: new Set(["config"]),
            cradleTypes: {
              config: { typeText: "{ logLevel: string }" },
            },
          }),
          parsedSlice({
            packageLabel: "@packages/infrastructure",
            sourceId: "@packages/infrastructure",
            typesPath: libTypesPath,
            externals: {
              config: { typeText: '{ logLevel: "error" | "warn" | "info" }' },
            },
          }),
        ]);

        const issues = checkExternalsSatisfaction({
          ...ctx,
          projectRoot: root,
        });
        assert.equal(issues.length, 1);
        assert.match(issues[0]!.summary, /config/);
        assert.match(issues[0]!.details.join("\n"), /incompatible/);
        assert.match(issues[0]!.details.join("\n"), /demanded:/);
        assert.match(issues[0]!.details.join("\n"), /supplied:/);
      });
    });

    describe("When supplied config is a nested superset of demanded slice", () => {
      it("should report no issues", () => {
        const root = mkdtempSync(
          path.join(tmpdir(), "ioc-validate-ext-nested-slice-"),
        );
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
            },
            null,
            2,
          ),
        );
        const localTypesPath = path.join(root, "local.types.ts");
        const libTypesPath = path.join(root, "lib.types.ts");
        writeFileSync(
          localTypesPath,
          typesSource(
            `config: { logLevel: "a" | "b"; log?: string; nodeEnv: string }`,
            "",
          ),
        );
        writeFileSync(
          libTypesPath,
          typesSource("", `config: { logLevel: "a" | "b"; log?: string }`),
        );

        const ctx = validateContext([
          parsedSlice({
            packageLabel: "@apps/api",
            sourceId: "local",
            typesPath: localTypesPath,
            cradleKeys: new Set(["config"]),
            cradleTypes: {
              config: {
                typeText:
                  '{ logLevel: "a" | "b"; log?: string; nodeEnv: string }',
              },
            },
          }),
          parsedSlice({
            packageLabel: "@packages/media-core",
            sourceId: "@packages/media-core",
            typesPath: libTypesPath,
            externals: {
              config: { typeText: '{ logLevel: "a" | "b"; log?: string }' },
            },
          }),
        ]);

        assert.equal(
          checkExternalsSatisfaction({ ...ctx, projectRoot: root }).length,
          0,
        );
      });
    });

    describe("When supplied object is missing demanded fields", () => {
      it("should report a type mismatch", () => {
        const root = mkdtempSync(path.join(tmpdir(), "ioc-validate-ext-under-"));
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
            },
            null,
            2,
          ),
        );
        const localTypesPath = path.join(root, "local.types.ts");
        const libTypesPath = path.join(root, "lib.types.ts");
        writeFileSync(
          localTypesPath,
          typesSource(`config: { a: string }`, ""),
        );
        writeFileSync(
          libTypesPath,
          typesSource("", `config: { a: string; b: number }`),
        );

        const ctx = validateContext([
          parsedSlice({
            packageLabel: "@apps/api",
            sourceId: "local",
            typesPath: localTypesPath,
            cradleKeys: new Set(["config"]),
            cradleTypes: {
              config: { typeText: "{ a: string }" },
            },
          }),
          parsedSlice({
            packageLabel: "@packages/lib",
            sourceId: "@packages/lib",
            typesPath: libTypesPath,
            externals: {
              config: { typeText: "{ a: string; b: number }" },
            },
          }),
        ]);

        const issues = checkExternalsSatisfaction({
          ...ctx,
          projectRoot: root,
        });
        assert.equal(issues.length, 1);
        assert.match(issues[0]!.summary, /config/);
      });
    });

    describe("When the TypeScript checker cannot be built", () => {
      it("should warn that type compatibility was not verified for supplied keys", () => {
        const ctx = validateContext([
          parsedSlice({
            packageLabel: "local",
            cradleKeys: new Set(["logger"]),
            cradleTypes: { logger: { typeText: "Logger" } },
          }),
          parsedSlice({
            packageLabel: "@lib/a",
            sourceId: "@lib/a",
            externals: { logger: { typeText: "Logger" } },
          }),
        ]);

        const issues = checkExternalsSatisfaction({
          ...ctx,
          projectRoot: path.join(tmpdir(), "ioc-validate-no-tsconfig"),
        });

        assert.equal(issues.length, 1);
        assert.equal(issues[0]!.severity, "warning");
        assert.match(issues[0]!.details.join("\n"), /Type compatibility not verified/);
        assert.match(issues[0]!.details.join("\n"), /tsc/);
        assert.equal(issues[0]!.details[0], CHECKER_UNAVAILABLE_CAVEAT);
      });
    });
  });

  describe("checkSchemaVersions", () => {
    describe("When a manifest schema version mismatches runtime", () => {
      it("should report a schema-version error", () => {
        const ctx = validateContext([
          parsedSlice({
            packageLabel: "@lib/a",
            manifestSchemaVersion: 1,
          }),
        ]);
        const issues = checkSchemaVersions(ctx);
        assert.equal(issues.length, 1);
        assert.equal(issues[0]!.category, "schema-version");
      });
    });
  });

  describe("checkSameKeyConflicts", () => {
    describe("When two manifests share a registration key without source", () => {
      it("should report a same-key-conflict error", () => {
        const impl = {
          registrationKey: "dup",
        };
        const ctx = validateContext([
          parsedSlice({
            packageLabel: "local",
            contracts: { A: { a: impl } },
          }),
          parsedSlice({
            packageLabel: "@lib/b",
            sourceId: "@lib/b",
            contracts: { B: { b: impl } },
          }),
        ]);
        const issues = checkSameKeyConflicts(ctx);
        assert.equal(issues.length, 1);
        assert.equal(issues[0]!.category, "same-key-conflict");
      });
    });

    describe("When source override resolves the conflict", () => {
      it("should report no issues", () => {
        const impl = { registrationKey: "dup" };
        const ctx = validateContext(
          [
            parsedSlice({
              packageLabel: "local",
              contracts: { A: { a: impl } },
            }),
            parsedSlice({
              packageLabel: "@lib/b",
              sourceId: "@lib/b",
              contracts: { B: { b: impl } },
            }),
          ],
          {
            composedPackageNames: ["@lib/b"],
            contracts: {
              A: { sourceOverride: { a: "local" } },
            },
          },
        );
        assert.equal(checkSameKeyConflicts(ctx).length, 0);
      });
    });
  });

  describe("checkGroupConsistency", () => {
    describe("When group kinds differ across manifests", () => {
      it("should report a group-kind error", () => {
        const ctx = validateContext([
          parsedSlice({
            packageLabel: "local",
            groupRoots: {
              g: {
                kind: "collection",
                baseType: "T",
                baseTypeId: "/a:T",
                members: [],
              },
            },
          }),
          parsedSlice({
            packageLabel: "@lib/b",
            sourceId: "@lib/b",
            groupRoots: {
              g: {
                kind: "object",
                baseType: "T",
                baseTypeId: "/a:T",
                members: {},
              },
            },
          }),
        ]);
        const issues = checkGroupConsistency(ctx);
        assert.ok(issues.some((i) => i.category === "group-kind"));
      });
    });

    describe("When base type ids differ but groupBaseTypeAliases declares equivalence", () => {
      it("should report no group-base-type issue", () => {
        const idA = "/path/a.ts:Discount";
        const idB = "/path/b.ts:Discount";
        const ctx = validateContext(
          [
            parsedSlice({
              packageLabel: "local",
              groupRoots: {
                g: {
                  kind: "collection",
                  baseType: "Discount",
                  baseTypeId: idA,
                  members: [],
                },
              },
            }),
            parsedSlice({
              packageLabel: "@lib/b",
              sourceId: "@lib/b",
              groupRoots: {
                g: {
                  kind: "collection",
                  baseType: "Discount",
                  baseTypeId: idB,
                  members: [],
                },
              },
            }),
          ],
          {
            groups: { baseTypeAliases: { g: [idA, idB] } },
          },
        );
        const issues = checkGroupConsistency(ctx);
        assert.equal(
          issues.filter((i) => i.category === "group-base-type").length,
          0,
        );
      });
    });

    describe("When base type ids differ without aliases", () => {
      it("should report a group-base-type error with alias suggestion", () => {
        const ctx = validateContext([
          parsedSlice({
            packageLabel: "local",
            groupRoots: {
              g: {
                kind: "collection",
                baseType: "T",
                baseTypeId: "/a:T",
                members: [],
              },
            },
          }),
          parsedSlice({
            packageLabel: "@lib/b",
            sourceId: "@lib/b",
            groupRoots: {
              g: {
                kind: "collection",
                baseType: "T",
                baseTypeId: "/b:T",
                members: [],
              },
            },
          }),
        ]);
        const issues = checkGroupConsistency(ctx);
        const base = issues.find((i) => i.category === "group-base-type");
        assert.ok(base !== undefined);
        assert.match(base.suggestedFix ?? "", /groupBaseTypeAliases/);
      });
    });
  });

  describe("checkDefaultAmbiguity", () => {
    describe("When multiple implementations exist without a default", () => {
      it("should report a default-ambiguity error", () => {
        const ctx = validateContext([
          parsedSlice({
            packageLabel: "local",
            contracts: {
              Widget: {
                a: { registrationKey: "widgetA" },
                b: { registrationKey: "widgetB" },
              },
            },
          }),
          parsedSlice({
            packageLabel: "@lib/x",
            sourceId: "@lib/x",
            contracts: {
              Widget: {
                c: { registrationKey: "widgetC" },
              },
            },
          }),
        ]);
        const issues = checkDefaultAmbiguity(ctx);
        assert.equal(issues.length, 1);
        assert.equal(issues[0]!.category, "default-ambiguity");
      });
    });
  });

  describe("checkAppConfigSanity", () => {
    describe("When registrations reference an unknown contract", () => {
      it("should report an app-config error", () => {
        const config = {
          composedManifests: ["@lib/a"],
          registrations: {
            Storge: { x: { default: true } },
          },
        } as IocConfig;
        const ctx = validateContext([
          parsedSlice({ packageLabel: "local", contracts: { Storage: { s: { registrationKey: "s" } } } }),
          parsedSlice({
            packageLabel: "@lib/a",
            sourceId: "@lib/a",
            contracts: {},
          }),
        ]);
        const issues = checkAppConfigSanity(config, ctx);
        assert.equal(issues.length, 1);
        assert.match(issues[0]!.summary, /Storge/);
      });
    });
  });

  describe("runAllValidationChecks", () => {
    describe("When multiple independent issues exist", () => {
      it("should aggregate externals and schema-version errors", () => {
        const config = { composedManifests: ["@lib/a"] } as IocConfig;
        const ctx = validateContext([
          parsedSlice({ packageLabel: "local", cradleKeys: new Set() }),
          parsedSlice({
            packageLabel: "@lib/a",
            sourceId: "@lib/a",
            manifestSchemaVersion: 1,
            externals: { missing: { typeText: "Missing" } },
          }),
        ]);
        const issues = runAllValidationChecks(config, ctx);
        assert.ok(issues.some((i) => i.category === "externals"));
        assert.ok(issues.some((i) => i.category === "schema-version"));
        assert.ok(issues.length >= 2);
      });
    });
  });
});

describe("parseIocManifestSource", () => {
  describe("When parsing a fixture manifest on disk", () => {
    it("should parse contracts and group roots", async () => {
      const { parseIocManifestSource } = await import("./parseGeneratedSource.js");
      const root = mkdtempSync(path.join(tmpdir(), "ioc-parse-"));
      const manifestPath = path.join(root, "ioc-manifest.ts");
      writeFileSync(
        manifestPath,
        manifestSource(
          `Storage: { s3: { registrationKey: "s3", default: true } }`,
          `loggers: { kind: "collection", baseType: "Logger", baseTypeId: "/l:Logger", members: [] },`,
        ),
      );
      const parsed = parseIocManifestSource(
        (await import("node:fs")).readFileSync(manifestPath, "utf8"),
        manifestPath,
      );
      assert.equal(parsed.manifestSchemaVersion, MANIFEST_SCHEMA_VERSION);
      assert.equal(parsed.contracts.Storage?.s3?.registrationKey, "s3");
      assert.equal(parsed.contracts.Storage?.s3?.default, true);
      assert.ok(parsed.groupRoots.loggers);
    });
  });
});
