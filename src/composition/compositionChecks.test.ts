import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { IocConfig } from "../config/iocConfig.js";
import { MANIFEST_SCHEMA_VERSION } from "../schemaVersion.js";
import {
  implSource,
  manifestSource,
  parsedSlice,
  typesSource,
  compositionContextFixture,
} from "../test-support/manifestFixtures.js";
import { checkAppConfigSanity } from "./checks/appConfig.js";
import { checkDefaultAmbiguity } from "./checks/defaultAmbiguity.js";
import { checkExternalsSatisfaction, CHECKER_UNAVAILABLE_CAVEAT } from "./checks/externals.js";
import { checkGroupConsistency } from "./checks/groups.js";
import { checkSameKeyConflicts } from "./checks/sameKeyConflict.js";
import { checkSchemaVersions } from "./checks/schemaVersion.js";
import { buildCompositionSlice } from "./compositionContext.js";
import { runCompositionChecks } from "./runCompositionChecks.js";

describe("validate checks", () => {
  describe("checkExternalsSatisfaction", () => {
    describe("When a composed package external is not in any cradle", () => {
      it("should report an externals error", () => {
        const ctx = compositionContextFixture([
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

        const ctx = compositionContextFixture([
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

        const ctx = compositionContextFixture([
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

        const ctx = compositionContextFixture([
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

        const ctx = compositionContextFixture([
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

        const ctx = compositionContextFixture([
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
        const ctx = compositionContextFixture([
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
        const ctx = compositionContextFixture([
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
        const ctx = compositionContextFixture([
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
        const ctx = compositionContextFixture(
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
        const ctx = compositionContextFixture([
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
        const ctx = compositionContextFixture(
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
        const ctx = compositionContextFixture([
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
        const ctx = compositionContextFixture([
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

    describe("When the contract is GROUPED (the field's shape)", () => {
      it("should vacate the check — grouped contracts have no slot to elect", () => {
        // Two config-declared collection groups, several implementations each, no `default: true`
        // anywhere. This is the ordinary, correct shape of a group; before grouped ⇒ group-only it
        // produced two `[default-ambiguity]` errors telling the developer to elect a default for a
        // key no consumer may name.
        const ctx = compositionContextFixture([
          parsedSlice({
            packageLabel: "local",
            contracts: {
              DomainEventHandler: {
                alpha: { registrationKey: "alphaHandler" },
                beta: { registrationKey: "betaHandler" },
                gamma: { registrationKey: "gammaHandler" },
                delta: { registrationKey: "deltaHandler" },
                epsilon: { registrationKey: "domainEventHandler" },
              },
              NotificationStrategy: {
                email: { registrationKey: "emailStrategy" },
                sms: { registrationKey: "smsStrategy" },
              },
            },
            groupRoots: {
              domainEventHandlers: {
                kind: "collection",
                baseType: "DomainEventHandler",
                baseTypeId: "pkg/contracts.ts:DomainEventHandler",
                members: [
                  { contractName: "DomainEventHandler", registrationKey: "alphaHandler" },
                  { contractName: "DomainEventHandler", registrationKey: "betaHandler" },
                ],
              },
              notificationStrategies: {
                kind: "object",
                baseType: "NotificationStrategy",
                baseTypeId: "pkg/contracts.ts:NotificationStrategy",
                members: {
                  emailStrategy: {
                    contractName: "NotificationStrategy",
                    registrationKey: "emailStrategy",
                  },
                },
              },
            },
          }),
        ]);

        assert.deepEqual(checkDefaultAmbiguity(ctx), []);
      });
    });

    describe("When a grouped and an ungrouped contract are both ambiguous", () => {
      it("should report only the ungrouped one", () => {
        const ctx = compositionContextFixture([
          parsedSlice({
            packageLabel: "local",
            contracts: {
              DomainEventHandler: {
                alpha: { registrationKey: "alphaHandler" },
                beta: { registrationKey: "betaHandler" },
              },
              Widget: {
                a: { registrationKey: "widgetA" },
                b: { registrationKey: "widgetB" },
              },
            },
            groupRoots: {
              domainEventHandlers: {
                kind: "collection",
                baseType: "DomainEventHandler",
                baseTypeId: "pkg/contracts.ts:DomainEventHandler",
                members: [
                  { contractName: "DomainEventHandler", registrationKey: "alphaHandler" },
                ],
              },
            },
          }),
        ]);

        const issues = checkDefaultAmbiguity(ctx);
        assert.equal(issues.length, 1);
        assert.match(issues[0]!.summary, /Widget/);
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
        const ctx = compositionContextFixture([
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

  describe("runCompositionChecks", () => {
    describe("When multiple independent issues exist", () => {
      it("should aggregate externals and schema-version errors", () => {
        const config = { composedManifests: ["@lib/a"] } as IocConfig;
        const ctx = compositionContextFixture([
          parsedSlice({ packageLabel: "local", cradleKeys: new Set() }),
          parsedSlice({
            packageLabel: "@lib/a",
            sourceId: "@lib/a",
            manifestSchemaVersion: 1,
            externals: { missing: { typeText: "Missing" } },
          }),
        ]);
        const issues = runCompositionChecks(config, ctx);
        assert.ok(issues.some((i) => i.category === "externals"));
        assert.ok(issues.some((i) => i.category === "schema-version"));
        assert.ok(issues.length >= 2);
      });
    });
  });
});

/**
 * The projection every check reads through. It exists because the manifest is parsed ONCE, by
 * `generator/parseGeneratedManifestSource.ts`, and narrowed here — the second, lesser parser that
 * used to sit under `validate/` recovered only `registrationKey` per implementation and only
 * `registrationKey` per group MEMBER, so the grouped-⇒-group-only rule could never see a member's
 * contract name through validate however correct the rule itself was.
 */
describe("buildCompositionSlice", () => {
  describe("When projecting a manifest with contracts and a group root", () => {
    it("should carry election defaults and member contract names", () => {
      const slice = buildCompositionSlice(
        "local",
        "local",
        "/pkg/generated/ioc-manifest.ts",
        manifestSource(
          `Storage: { s3: ${implSource("s3", ", default: true")} }`,
          `loggers: { kind: "collection", baseType: "Logger", baseTypeId: "/l:Logger", members: [{ contractName: "ConsoleLogger", registrationKey: "consoleLogger" }] },`,
        ),
        "/pkg/generated/ioc-registry.types.ts",
        typesSource("s3: unknown", ""),
      );

      assert.equal(slice.manifestSchemaVersion, MANIFEST_SCHEMA_VERSION);
      assert.equal(slice.contracts.Storage?.s3?.registrationKey, "s3");
      assert.equal(slice.contracts.Storage?.s3?.default, true);
      assert.deepEqual(slice.groupRoots.loggers?.members, [
        { contractName: "ConsoleLogger", registrationKey: "consoleLogger" },
      ]);
      assert.deepEqual([...slice.cradleKeys], ["s3"]);
    });
  });
});
