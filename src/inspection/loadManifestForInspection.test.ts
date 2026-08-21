import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import {
  IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS,
  type IocGeneratedContainerManifest,
  type IocGroupsManifest,
} from "../core/manifest.js";
import { formatInspectionReport } from "./formatReports.js";
import { loadManifestForInspection } from "./loadManifestForInspection.js";
import { formatInspectionReportJson } from "./reportJson.js";
import { buildInspectionReport } from "./reports.js";

/**
 * A generated manifest as a CONSUMER has one on disk: TypeScript, importing its units relatively,
 * with a scope root and a group root alongside the contracts. Nothing here is special-cased for the
 * parser — it is the shape `writeManifest` emits.
 */
const MANIFEST_SOURCE = `/* AUTO-GENERATED. DO NOT EDIT. */
import type {
  IocGeneratedContainerManifest,
  IocModuleNamespace,
} from "ioc-manifest";

import * as ioc_units from "../units.js";

type IocManifestGroupRoots = {
  readonly readersGroup: {
    readonly kind: "collection";
    readonly baseType: "Reader";
    readonly baseTypeId: "app/src/units.ts:Reader";
    readonly members: readonly [
      { readonly contractName: "Reader"; readonly registrationKey: "restReader" },
    ];
  };
};

export const iocManifest = {
  manifestSchemaVersion: 3,

  moduleImports: [ioc_units] as const satisfies readonly IocModuleNamespace[],

  contracts: {
    Logger: {
      consoleLogger: {
        exportName: "buildConsoleLogger",
        registrationKey: "consoleLogger",
        modulePath: "units.ts",
        relImport: "../units.js",
        contractName: "Logger",
        implementationName: "consoleLogger",
        lifetime: "singleton",
        moduleIndex: 0,
        default: true,
        discoveredBy: "naming",
      },
    },
    Reader: {
      graphReader: {
        exportName: "buildGraphReader",
        registrationKey: "graphReader",
        modulePath: "units.ts",
        relImport: "../units.js",
        contractName: "Reader",
        implementationName: "graphReader",
        lifetime: "scoped",
        moduleIndex: 0,
        discoveredBy: "naming",
        dependencyContractNames: ["Logger"],
        dependencyKeys: ["logger"],
      },
      restReader: {
        kind: "class",
        exportName: "RestReader",
        registrationKey: "restReader",
        modulePath: "units.ts",
        relImport: "../units.js",
        contractName: "Reader",
        implementationName: "restReader",
        lifetime: "transient",
        moduleIndex: 0,
        default: true,
        discoveredBy: "implements",
        accessKey: "reader",
      },
    },
  },

  scopeRoots: {
    RequestReport: {
      requestReport: {
        exportName: "buildRequestReport",
        openerKey: "openRequestReportScope",
        variantKey: "requestReport",
        contractName: "RequestReport",
        variantName: "requestReport",
        modulePath: "units.ts",
        relImport: "../units.js",
        lbvKeys: ["viewer"],
        moduleIndex: 0,
      },
    },
  },

  // readersGroup
  readersGroup: {
    kind: "collection",
    baseType: "Reader",
    baseTypeId: "app/src/units.ts:Reader",
    members: [{ contractName: "Reader", registrationKey: "restReader" }],
  },
} as const satisfies IocGeneratedContainerManifest<IocManifestGroupRoots>;

export const IOC_SCOPE_PROVIDED_KEYS = [] as const;

export const IOC_MANIFEST_FEATURES = ["dependencyKeys"] as const;
`;

const UNITS_SOURCE = `export const buildConsoleLogger = () => ({ log: () => {} });
export const buildGraphReader = () => ({ read: () => "" });
export class RestReader {
  read() {
    return "";
  }
}
export const buildRequestReport = () => ({ render: () => "" });
`;

/**
 * A consumer workspace: `ioc.config.ts` under `src/`, generated manifest under `src/generated/`.
 *
 * `manifest` is optional so the missing-file and unparseable-file cases can share the same setup.
 */
const writeConsumerWorkspace = (
  label: string,
  manifest?: string,
): { root: string; manifestPath: string } => {
  const root = mkdtempSync(path.join(tmpdir(), `ioc-inspect-${label}-`));
  mkdirSync(path.join(root, "src", "generated"), { recursive: true });
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "consumer", type: "module" }),
  );
  writeFileSync(path.join(root, "src", "units.ts"), UNITS_SOURCE);
  writeFileSync(
    path.join(root, "src", "ioc.config.ts"),
    `export default { discovery: { scanDirs: "src", generatedDir: "src/generated" } };`,
  );

  const manifestPath = path.join(
    root,
    "src",
    "generated",
    "ioc-manifest.ts",
  );
  if (manifest !== undefined) {
    writeFileSync(manifestPath, manifest);
  }
  return { root, manifestPath };
};

const loadFrom = (root: string) =>
  loadManifestForInspection(undefined, path.join(root, "src"));

/** Group roots as the pre-parse `inspect` read them back: every top-level key that is not fixed. */
const groupRootsOf = (
  manifest: IocGeneratedContainerManifest,
): IocGroupsManifest => {
  const groups: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(manifest)) {
    if (!IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS.has(key)) {
      groups[key] = value;
    }
  }
  return groups as IocGroupsManifest;
};

describe("loadManifestForInspection", () => {
  describe("When a consumer-shaped generated manifest is on disk", () => {
    it("should build the full report without importing the manifest", async () => {
      const { root } = writeConsumerWorkspace("full", MANIFEST_SOURCE);

      const source = await loadFrom(root);
      const report = buildInspectionReport(source.contracts, {
        groups: source.groups,
        scopeRoots: source.scopeRoots,
      });

      assert.deepEqual(
        report.contracts.map((contract) => contract.contractName),
        ["Logger", "Reader"],
      );
      assert.deepEqual(report.manifestIssues, []);

      const reader = report.contracts.find((c) => c.contractName === "Reader")!;
      assert.strictEqual(reader.defaultImplementationName, "restReader");
      assert.deepEqual(
        reader.implementations.map((impl) => [
          impl.implementationName,
          impl.registrationKey,
          impl.lifecycle,
          impl.exportName,
          impl.isDefault,
        ]),
        [
          ["graphReader", "graphReader", "scoped", "buildGraphReader", false],
          ["restReader", "restReader", "transient", "RestReader", true],
        ],
      );

      assert.deepEqual(report.openers, [
        {
          openerKey: "openRequestReportScope",
          contractName: "RequestReport",
          variantName: "requestReport",
          lbvKeys: ["viewer"],
        },
      ]);
      assert.deepEqual(
        report.groups.map((group) => [group.groupName, group.baseType]),
        [["readersGroup", "Reader"]],
      );

      // The human and JSON renderings both come out whole, which is what the command prints.
      const text = formatInspectionReport(report, { color: false });
      assert.match(text, /Reader/u);
      assert.match(text, /openRequestReportScope/u);
      assert.match(
        formatInspectionReportJson(report),
        /"openerKey": "openRequestReportScope"/u,
      );
    });

    it("should produce byte-identical output to the report the import path built", async () => {
      // Field parity, proven where both paths can run: these tests execute under a TS-capable
      // runtime, so the old `await import()` path still works here and can be compared against
      // directly. In a consumer it cannot run at all, which is the whole reason it was replaced.
      const { root, manifestPath } = writeConsumerWorkspace(
        "parity",
        MANIFEST_SOURCE,
      );

      const imported = (await import(pathToFileURL(manifestPath).href)) as {
        iocManifest: IocGeneratedContainerManifest;
      };
      const fromImport = buildInspectionReport(imported.iocManifest.contracts, {
        groups: groupRootsOf(imported.iocManifest),
        scopeRoots: imported.iocManifest.scopeRoots,
      });

      const source = await loadFrom(root);
      const fromParse = buildInspectionReport(source.contracts, {
        groups: source.groups,
        scopeRoots: source.scopeRoots,
      });

      assert.deepEqual(fromParse, fromImport);
      assert.strictEqual(
        formatInspectionReportJson(fromParse),
        formatInspectionReportJson(fromImport),
      );
      assert.strictEqual(
        formatInspectionReport(fromParse, { color: false }),
        formatInspectionReport(fromImport, { color: false }),
      );
    });
  });

  describe("When the generated manifest is missing", () => {
    it("should name the path and point at generation", async () => {
      const { root, manifestPath } = writeConsumerWorkspace("missing");

      await assert.rejects(loadFrom(root), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /not found/u);
        assert.ok(error.message.includes(manifestPath));
        assert.match(error.message, /Run `ioc generate`/u);
        return true;
      });
    });
  });

  describe("When the generated manifest does not parse as a manifest", () => {
    it("should name the file and suggest regenerating it", async () => {
      const { root, manifestPath } = writeConsumerWorkspace(
        "unparseable",
        "export const somethingElse = {};\n",
      );

      await assert.rejects(loadFrom(root), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes(manifestPath));
        assert.match(error.message, /does not export iocManifest/u);
        assert.match(error.message, /Re-run `ioc generate`/u);
        return true;
      });
    });

    it("should report syntactically broken source rather than a partial manifest", async () => {
      const { root, manifestPath } = writeConsumerWorkspace(
        "truncated",
        MANIFEST_SOURCE.slice(0, MANIFEST_SOURCE.indexOf("contracts:")),
      );

      await assert.rejects(loadFrom(root), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes(manifestPath));
        assert.match(error.message, /Re-run `ioc generate`/u);
        return true;
      });
    });
  });
});
