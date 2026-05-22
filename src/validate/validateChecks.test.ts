import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { IocConfig } from "../config/iocConfig.js";
import { MANIFEST_SCHEMA_VERSION } from "../schemaVersion.js";
import { checkAppConfigSanity } from "./checks/appConfig.js";
import { checkDefaultAmbiguity } from "./checks/defaultAmbiguity.js";
import { checkExternalsSatisfaction } from "./checks/externals.js";
import { checkGroupConsistency } from "./checks/groups.js";
import { checkSameKeyConflicts } from "./checks/sameKeyConflict.js";
import { checkSchemaVersions } from "./checks/schemaVersion.js";
import { runAllValidationChecks } from "./runValidate.js";
import type { ParsedManifestSlice, ValidateContext } from "./types.js";

const manifestSource = (
  contracts: string,
  extras = "",
  version: number = MANIFEST_SCHEMA_VERSION,
): string => `export const iocManifest = {
  manifestSchemaVersion: ${version},
  moduleImports: [],
  contracts: { ${contracts} },
  ${extras}
};`;

const typesSource = (
  cradle: string,
  externals: string,
): string => `export interface IocGeneratedCradle { ${cradle} }
export interface IocExternals { ${externals} }`;

const slice = (
  partial: Partial<ParsedManifestSlice> & Pick<ParsedManifestSlice, "packageLabel">,
): ParsedManifestSlice => ({
  sourceId: partial.sourceId ?? partial.packageLabel,
  manifestPath: partial.manifestPath ?? "/tmp/ioc-manifest.ts",
  typesPath: partial.typesPath ?? "/tmp/ioc-registry.types.ts",
  manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
  contracts: {},
  groupRoots: {},
  cradleKeys: new Set(),
  externals: {},
  ...partial,
});

const baseCtx = (
  slices: readonly ParsedManifestSlice[],
  overrides?: ValidateContext["overrides"],
): ValidateContext => ({
  projectRoot: "/proj",
  configPath: "/proj/ioc.config.ts",
  slices,
  composedPackageNames: slices.slice(1).map((s) => s.sourceId),
  overrides,
  localContractNames: new Set(Object.keys(slices[0]?.contracts ?? {})),
  composedContractNames: new Set(
    slices.slice(1).flatMap((s) => Object.keys(s.contracts)),
  ),
  declaredGroupNames: new Set(
    slices.flatMap((s) => Object.keys(s.groupRoots)),
  ),
});

describe("validate checks", () => {
  describe("checkExternalsSatisfaction", () => {
    describe("When a composed package external is not in any cradle", () => {
      it("should report an externals error", () => {
        const ctx = baseCtx([
          slice({
            packageLabel: "local",
            cradleKeys: new Set(["appOnly"]),
            externals: {},
          }),
          slice({
            packageLabel: "@lib/a",
            sourceId: "@lib/a",
            cradleKeys: new Set(["svc"]),
            externals: { logger: { typeText: "Logger" } },
          }),
        ]);
        const issues = checkExternalsSatisfaction(ctx);
        assert.equal(issues.length, 1);
        assert.equal(issues[0]!.category, "externals");
        assert.match(issues[0]!.summary, /logger/);
      });
    });

    describe("When all externals are supplied in a cradle", () => {
      it("should report no issues", () => {
        const ctx = baseCtx([
          slice({
            packageLabel: "local",
            cradleKeys: new Set(["logger"]),
          }),
          slice({
            packageLabel: "@lib/a",
            sourceId: "@lib/a",
            externals: { logger: { typeText: "Logger" } },
          }),
        ]);
        assert.equal(checkExternalsSatisfaction(ctx).length, 0);
      });
    });
  });

  describe("checkSchemaVersions", () => {
    describe("When a manifest schema version mismatches runtime", () => {
      it("should report a schema-version error", () => {
        const ctx = baseCtx([
          slice({
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
        const ctx = baseCtx([
          slice({
            packageLabel: "local",
            contracts: { A: { a: impl } },
          }),
          slice({
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
        const ctx = baseCtx(
          [
            slice({
              packageLabel: "local",
              contracts: { A: { a: impl } },
            }),
            slice({
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
        const ctx = baseCtx([
          slice({
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
          slice({
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

    describe("When base type ids differ without aliases", () => {
      it("should report a group-base-type error with alias suggestion", () => {
        const ctx = baseCtx([
          slice({
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
          slice({
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
        const ctx = baseCtx([
          slice({
            packageLabel: "local",
            contracts: {
              Widget: {
                a: { registrationKey: "widgetA" },
                b: { registrationKey: "widgetB" },
              },
            },
          }),
          slice({
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
        const ctx = baseCtx([
          slice({ packageLabel: "local", contracts: { Storage: { s: { registrationKey: "s" } } } }),
          slice({
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
        const ctx = baseCtx([
          slice({ packageLabel: "local", cradleKeys: new Set() }),
          slice({
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
