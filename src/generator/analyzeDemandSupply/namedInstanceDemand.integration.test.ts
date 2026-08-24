/**
 * `Named<T>`: declaring a demand for one SPECIFIC implementation, and the errors that make the
 * declaration required rather than optional.
 *
 * The pair of rules is the point. `Named<T>` on an implementation key is the only way to demand
 * that implementation; a bare contract type on the same key is a hard error; and the marker
 * anywhere else — a contract slot key, a group root, an opener, a name nothing registers — is a
 * hard error too. Between them there is exactly one spelling for each of the five things a deps
 * property can be.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import type { IocConfig } from "../../config/iocConfig.js";
import { buildGroupPlan } from "../../groups/resolveGroupPlan.js";
import { analyzeDemandSupply } from "./index.js";
import { contractSlotsForPlans } from "../contractSlotKeys.js";
import { discoverFactories } from "../discoverFactories/discoverFactories.js";
import { buildRegistrationPlan } from "../resolveRegistrationPlan.js";
import { buildScopeRootOpeners } from "../scopeRootOpeners.js";
import { buildManifestArtifactSources } from "../writeManifest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../..");
const fixtureDir = path.join(
  __dirname,
  "..",
  "test-fixtures",
  "contract-slots",
);
const generatedDir = path.join(fixtureDir, "generated");
const scanDirs = [{ absPath: fixtureDir }];
const manifestOutPath = path.join(generatedDir, "ioc-manifest.ts");

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
};

const electOptional = {
  registrations: {
    AuthMiddleware: { optionalAuthMiddleware: { default: true } },
  },
} as unknown as IocConfig;

const withGroup = {
  registrations: {
    AuthMiddleware: { optionalAuthMiddleware: { default: true } },
  },
  groups: {
    authMiddlewaresGroup: { kind: "collection", baseType: "AuthMiddleware" },
  },
} as unknown as IocConfig;

const generate = (fileNames: readonly string[], config?: IocConfig) => {
  const files = fileNames.map((name) => path.join(fixtureDir, name));
  const program = ts.createProgram({ rootNames: files, options: compilerOptions });
  const { contractMap, acceptedFactories, scopeRoots } = discoverFactories(
    files,
    program,
    projectRoot,
    "build",
    { projectRoot, scanDirs, generatedDir },
    config,
    { collectFileRecords: true },
  );
  const plans = buildRegistrationPlan(contractMap, config, {
    projectRoot,
    scanDirs,
  });
  const groupResult = buildGroupPlan(config?.groups, plans, {
    program,
    generatedDir,
    scanDirs,
  });
  const demandSupply = analyzeDemandSupply(acceptedFactories, {
    program,
    projectRoot,
    scanDirs,
    generatedDir,
    groupsManifest: groupResult?.manifest,
    scopeRoots,
    contractSlots: contractSlotsForPlans(plans),
  });
  const sources = buildManifestArtifactSources(
    [...acceptedFactories],
    plans,
    groupResult?.manifest,
    manifestOutPath,
    "ioc-manifest",
    {
      demandSupply,
      registryTypesBuildContext: {
        program,
        generatedDir,
        scanDirs,
        projectRoot,
      },
      scopeRootOpeners: buildScopeRootOpeners(scopeRoots, {
        program,
        projectRoot,
        scanDirs,
        generatedDir,
      }),
    },
  );
  return { plans, demandSupply, sources };
};

describe("Named<T> demands", () => {
  describe("When an implementation key carries the marker", () => {
    it("should accept it alongside a bare contract-key demand", () => {
      const { demandSupply } = generate(
        ["contracts.ts", "auth.ts", "pipeline.ts"],
        electOptional,
      );

      // Both spellings resolve, and both are locally supplied.
      for (const key of ["authMiddleware", "strictAuthMiddleware"]) {
        assert.equal(
          demandSupply.entries.find((e) => e.key === key)?.classification,
          "local",
          `${key} must be locally supplied`,
        );
      }
      assert.deepEqual(demandSupply.externalKeys, []);
    });

    it("should never let the marker reach an emitted position", () => {
      const { sources } = generate(
        ["contracts.ts", "auth.ts", "pipeline.ts"],
        electOptional,
      );

      // `Named<T>` IS `T` to the checker, so nothing downstream has an unwrap to perform — but a
      // regression here would print a name the generated file cannot import, so it is pinned.
      assert.equal(sources.typesSource.includes("Named"), false);
      assert.equal(sources.mainSource.includes("Named"), false);
      assert.match(
        sources.mainSource,
        /dependencyKeys: \["authMiddleware","strictAuthMiddleware"\]/,
      );
      assert.match(
        sources.mainSource,
        /dependencyContractNames: \["AuthMiddleware"\]/,
      );
    });
  });

  describe("When an implementation key is demanded bare", () => {
    it("should hard-error naming both legal spellings", () => {
      assert.throws(
        () =>
          generate(
            ["contracts.ts", "auth.ts", "bad-bare-impl-demand.ts"],
            electOptional,
          ),
        (error: Error) => {
          assert.match(error.message, /\[named-marker-required\]/);
          assert.match(
            error.message,
            /For the elected default, demand the contract key `authMiddleware: AuthMiddleware`/,
          );
          assert.match(
            error.message,
            /write `strictAuthMiddleware: Named<AuthMiddleware>`/,
          );
          return true;
        },
      );
    });

    it("should exempt the enumerated indexed-access reference form", () => {
      // `IocGeneratedCradle["strictAuthMiddleware"]` has already said which cradle key it names, so
      // there is no ambiguity for the marker to remove. Pins where marker recognition sits relative
      // to the generated-reference claim parsers.
      const { demandSupply } = generate(
        ["contracts.ts", "auth.ts", "indexed-impl-demand.ts"],
        electOptional,
      );
      assert.equal(
        demandSupply.entries.find((e) => e.key === "strictAuthMiddleware")
          ?.classification,
        "local",
      );
    });
  });

  describe("When the marker names the wrong contract", () => {
    it("should hard-error on identity, not assignability", () => {
      assert.throws(
        () =>
          generate(
            ["contracts.ts", "auth.ts", "bad-named-wrong-contract.ts"],
            electOptional,
          ),
        (error: Error) => {
          assert.match(error.message, /\[named-contract-mismatch\]/);
          // Both contracts named: the one demanded and the one the implementation declares —
          // each on its own labeled line.
          assert.match(error.message, /Demands `Named<AuditSink>`/);
          assert.match(error.message, /^ +key: +"strictAuthMiddleware"$/m);
          assert.match(error.message, /^ +demanded: +"AuditSink"$/m);
          assert.match(error.message, /^ +declares: +"AuthMiddleware"$/m);
          assert.match(error.message, /^ +registered: +in this package$/m);
          return true;
        },
      );
    });
  });

  describe("When the marker sits where it does not belong", () => {
    it("should reject it on a contract slot key", () => {
      assert.throws(
        () =>
          generate(
            ["contracts.ts", "auth.ts", "bad-named-on-contract-key.ts"],
            electOptional,
          ),
        /\[named-on-contract-key\][\s\S]*^ +contract: +"AuthMiddleware"$/m,
      );
    });

    it("should reject it on a group root key", () => {
      assert.throws(
        () =>
          generate(
            ["contracts.ts", "auth.ts", "bad-named-on-group-key.ts"],
            withGroup,
          ),
        /\[named-on-group-key\][\s\S]*^ +group: +"/m,
      );
    });

    it("should reject it on a scope-root opener key", () => {
      assert.throws(
        () =>
          generate([
            "contracts.ts",
            "scope-root.ts",
            "scope-root-reexports.ts",
            "bad-named-on-opener-key.ts",
          ]),
        /\[named-on-opener-key\][\s\S]*^ +opener: +"/m,
      );
    });

    it("should reject it on a key nothing registers", () => {
      assert.throws(
        () =>
          generate(
            ["contracts.ts", "auth.ts", "bad-named-unknown-key.ts"],
            electOptional,
          ),
        /\[named-unknown-key\][\s\S]*no implementation — local or composed — is registered under "viewerAuthMiddleware"/,
      );
    });

    it("should reject wrong arity, following the scope-root precedent", () => {
      assert.throws(
        () =>
          generate(
            ["contracts.ts", "auth.ts", "bad-named-wrong-arity.ts"],
            electOptional,
          ),
        /\[named-wrong-arity\][\s\S]*write `Named<TContract>`/,
      );
    });
  });

  describe("When several properties offend at once", () => {
    it("should aggregate every offender into one error", () => {
      assert.throws(
        () =>
          generate(
            [
              "contracts.ts",
              "auth.ts",
              "bad-bare-impl-demand.ts",
              "bad-named-unknown-key.ts",
            ],
            {
              registrations: {
                AuthMiddleware: { optionalAuthMiddleware: { default: true } },
                RequestPipeline: { barePipeline: { default: true } },
              },
            } as unknown as IocConfig,
          ),
        (error: Error) => {
          assert.match(error.message, /^\[ioc\] 2 deps properties/);
          assert.match(error.message, /\[named-marker-required\]/);
          assert.match(error.message, /\[named-unknown-key\]/);
          return true;
        },
      );
    });
  });
});
