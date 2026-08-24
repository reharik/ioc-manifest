/**
 * Contract-slot keys and `Named<T>` ACROSS a package boundary.
 *
 * A composing app never sees a library's sources — only its generated manifest. So both halves of
 * the demand model have to be reconstructible from that file: which key is the library's contract
 * slot (and which implementation its election named), and what contract each implementation
 * declares, so `Named<C>` can be checked against a unit in another package at all.
 *
 * The fixture is built on disk per test rather than committed, because half of it is a package
 * under `node_modules` — the same shape `composedSubtreeDemand.integration.test.ts` uses, for the
 * same reason.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { analyzeDemandSupply } from "./analyzeDemandSupply/index.js";
import { contractSlotsForPlans } from "./contractSlotKeys.js";
import { discoverFactories } from "./discoverFactories/discoverFactories.js";
import { loadComposedManifestSupply } from "./loadComposedManifestUnits.js";
import { buildRegistrationPlan } from "./resolveRegistrationPlan.js";
import {
  buildScopeRootSupplyIndex,
  registrationsSupplyingKey,
} from "./verifyScopeRoots.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** The marker's real declaration — the fixture imports it the way a consuming app does. */
const namedModule = path
  .join(__dirname, "../named/named.js")
  .replace(/\\/g, "/");

const LIB = "@test/lib-auth";

/**
 * The library manifest, as this generator writes it.
 *
 * `optionalAuthMiddleware` carries `default: true`, so the library's `AuthMiddleware` slot key is
 * reconstructible; `strictAuthMiddleware` does not, and is reachable only by its own name.
 */
const LIBRARY_MANIFEST = `export const iocManifest = {
  manifestSchemaVersion: 3,

  moduleImports: [],

  contracts: {
    AuthMiddleware: {
      optionalAuthMiddleware: {
        exportName: "buildOptionalAuthMiddleware",
        registrationKey: "optionalAuthMiddleware",
        modulePath: "factories/buildOptionalAuthMiddleware.ts",
        relImport: "../factories/buildOptionalAuthMiddleware.js",
        contractName: "AuthMiddleware",
        implementationName: "optionalAuthMiddleware",
        lifetime: "singleton",
        moduleIndex: 0,
        default: true,
        dependencyKeys: [],
      },
      strictAuthMiddleware: {
        exportName: "buildStrictAuthMiddleware",
        registrationKey: "strictAuthMiddleware",
        modulePath: "factories/buildStrictAuthMiddleware.ts",
        relImport: "../factories/buildStrictAuthMiddleware.js",
        contractName: "AuthMiddleware",
        implementationName: "strictAuthMiddleware",
        lifetime: "singleton",
        moduleIndex: 1,
        dependencyKeys: [],
      },
    },
    AuditSink: {
      auditSink: {
        exportName: "buildAuditSink",
        registrationKey: "auditSink",
        modulePath: "factories/buildAuditSink.ts",
        relImport: "../factories/buildAuditSink.js",
        contractName: "AuditSink",
        implementationName: "auditSink",
        lifetime: "singleton",
        moduleIndex: 2,
        default: true,
        dependencyKeys: [],
      },
    },
  },
} as const;

export const IOC_MANIFEST_FEATURES = ["dependencyKeys"] as const;
`;

const APP_CONTRACTS = `export interface AuthMiddleware {
  name: string;
  handle: (path: string) => string;
}
export interface AuditSink {
  write: (line: string) => void;
}
export interface RequestPipeline {
  run: (path: string) => string;
}
`;

/** The consumer under test, parameterised by how it spells the composed implementation demand. */
const appPipeline = (property: string): string =>
  `import type { Named } from "${namedModule}";
import type {
  AuditSink,
  AuthMiddleware,
  RequestPipeline,
} from "../contracts.js";

type Deps = {
  ${property}
};

export const buildRequestPipeline = (deps: Deps): RequestPipeline => ({
  run: (path: string) => JSON.stringify(Object.keys(deps)) + path,
});

void (undefined as unknown as [AuditSink, AuthMiddleware, Named<AuditSink>]);
`;

type Fixture = {
  projectRoot: string;
  files: string[];
  scanDirs: { absPath: string }[];
};

const buildFixture = (pipelineProperty: string): Fixture => {
  const root = mkdtempSync(path.join(tmpdir(), "ioc-contract-slots-"));
  const srcDir = path.join(root, "src");
  const factoriesDir = path.join(srcDir, "factories");
  mkdirSync(factoriesDir, { recursive: true });

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
    LIBRARY_MANIFEST,
  );

  writeFileSync(path.join(srcDir, "contracts.ts"), APP_CONTRACTS);
  const pipelinePath = path.join(factoriesDir, "buildRequestPipeline.ts");
  writeFileSync(pipelinePath, appPipeline(pipelineProperty));

  return {
    projectRoot: root,
    files: [path.join(srcDir, "contracts.ts"), pipelinePath],
    scanDirs: [{ absPath: factoriesDir }],
  };
};

/** Discovers, plans, loads composed supply and runs demand/supply — `generateManifest`'s order. */
const analyze = async (pipelineProperty: string) => {
  const fixture = buildFixture(pipelineProperty);
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
    { projectRoot: fixture.projectRoot, scanDirs: fixture.scanDirs, generatedDir },
    undefined,
    { collectFileRecords: true },
  );
  const plans = buildRegistrationPlan(contractMap, undefined, {
    projectRoot: fixture.projectRoot,
    scanDirs: fixture.scanDirs,
  });
  const composedSupply = await loadComposedManifestSupply(
    fixture.projectRoot,
    [LIB],
  );

  const demandSupply = analyzeDemandSupply(acceptedFactories, {
    program,
    projectRoot: fixture.projectRoot,
    scanDirs: fixture.scanDirs,
    generatedDir,
    scopeRoots,
    contractSlots: contractSlotsForPlans(plans),
    composedImplementations: composedSupply.units.map((unit) => ({
      registrationKey: unit.registrationKey,
      contractName: unit.contractName,
      packageName: unit.packageName,
    })),
    composedSlots: composedSupply.accessKeys,
  });

  return { composedSupply, demandSupply, plans, program, fixture };
};

describe("contract slots and Named<T> across a package boundary", () => {
  describe("When the composed manifest carries an election", () => {
    it("should reconstruct the library's slot key and its target", async () => {
      const { composedSupply } = await analyze(
        "authMiddleware: AuthMiddleware;",
      );

      assert.equal(
        composedSupply.accessKeys.get("authMiddleware"),
        "optionalAuthMiddleware",
      );
    });

    it("should satisfy a slot-key demand through the composed election", async () => {
      const { composedSupply, plans, program, fixture } = await analyze(
        "authMiddleware: AuthMiddleware;",
      );

      // The walk's supply index is where a composed slot key becomes a resolvable edge; the
      // composing app's own `IocExternals` still carries the key, because composition — not this
      // package — is what supplies it.
      const index = buildScopeRootSupplyIndex({
        program,
        projectRoot: fixture.projectRoot,
        scanDirs: fixture.scanDirs,
        acceptedFactories: [],
        plans,
        composedSupply,
      });
      assert.deepEqual(registrationsSupplyingKey("authMiddleware", index), [
        "optionalAuthMiddleware",
      ]);
    });
  });

  describe("When a composed implementation key is demanded", () => {
    it("should accept the marker against the composed unit's declared contract", async () => {
      const { demandSupply } = await analyze(
        "strictAuthMiddleware: Named<AuthMiddleware>;",
      );

      // Composed keys are supplied by composition, not by this package, so the key is still an
      // external — what the marker changes is that the demand is now DECLARED rather than inferred.
      assert.ok(demandSupply.externalKeys.includes("strictAuthMiddleware"));
    });

    it("should reject the bare spelling", async () => {
      await assert.rejects(
        () => analyze("strictAuthMiddleware: AuthMiddleware;"),
        (error: Error) => {
          assert.match(error.message, /\[named-marker-required\]/);
          assert.match(
            error.message,
            /in composed package "@test\/lib-auth"/,
          );
          return true;
        },
      );
    });

    it("should enforce strict contract identity across the boundary", async () => {
      await assert.rejects(
        () => analyze("strictAuthMiddleware: Named<AuditSink>;"),
        (error: Error) => {
          assert.match(error.message, /\[named-contract-mismatch\]/);
          assert.match(error.message, /Demands `Named<AuditSink>`/);
          // The mechanism is now labeled fields: what was demanded, what the unit declares, where
          // it is registered.
          assert.match(error.message, /^ +demanded: +"AuditSink"$/m);
          assert.match(error.message, /^ +declares: +"AuthMiddleware"$/m);
          assert.match(
            error.message,
            /^ +registered: +in composed package "@test\/lib-auth"$/m,
          );
          return true;
        },
      );
    });

    it("should reject the marker on a composed contract slot key", async () => {
      await assert.rejects(
        () => analyze("auditSink: Named<AuditSink>;"),
        /\[named-on-contract-key\][\s\S]*^ +contract: +"AuditSink"$/m,
      );
    });
  });
});
