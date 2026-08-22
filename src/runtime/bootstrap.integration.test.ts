import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { asValue, createContainer, type AwilixContainer } from "awilix";
import type { MediaStorage } from "../examples/b-multiple-implementations.js";
import type {
  IocExternals,
  IocGeneratedCradle,
} from "../generated/ioc-registry.types.js";
import { iocManifest } from "../generated/ioc-manifest.js";
import { resolveManifestAccessKey } from "../core/contractAccessKey.js";
import { selectDefaultImplementationName } from "../core/defaultImplementationSelection.js";
import { groupedContractNamesFromManifest } from "../core/groupedContractNames.js";
import {
  IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS,
  type IocGroupsManifest,
} from "../core/manifest.js";
import { registerIocFromManifest } from "./bootstrap.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generatedDir = path.join(__dirname, "../generated");

/**
 * Compiles one statement against the real generated registry types and returns its diagnostics.
 *
 * The probe file is written into the generated directory (in memory only) so its relative import
 * resolves exactly as a consumer's would. `open` is declared, never resolved: what is under test is
 * the emitted opener TYPE, not the container.
 */
const typecheckAgainstGeneratedTypes = (
  statement: string,
): readonly ts.Diagnostic[] => {
  const probePath = path.join(generatedDir, "__opener-arity-probe.ts");
  const source = [
    'import type { OpenPublicReportScope } from "./ioc-registry.types.js";',
    "declare const open: OpenPublicReportScope;",
    statement,
  ].join("\n");

  const host = ts.createCompilerHost({});
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, langVersion, onError, shouldCreate) =>
    path.normalize(fileName) === path.normalize(probePath)
      ? ts.createSourceFile(fileName, source, langVersion, true)
      : originalGetSourceFile(fileName, langVersion, onError, shouldCreate);

  const program = ts.createProgram({
    rootNames: [probePath],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
    host,
  });
  return program.getSemanticDiagnostics(program.getSourceFile(probePath)!);
};

describe("registerIocFromManifest", () => {
  describe("When resolving the contract default slot", () => {
    it("should resolve to the selected default implementation", async () => {
      const container = createContainer<IocGeneratedCradle>();
      registerIocFromManifest(container, [iocManifest]);
      const media = container.resolve("mediaStorage") as MediaStorage;
      await media.put("k");
      // The ELECTEE, per `ioc.config`'s `MediaStorage.s3MediaStorage.default: true`. This assertion
      // used to read "direct-contract": an implementation exported as `buildMediaStorage` owned the
      // slot key outright, so the key handed out the occupant while the election named someone
      // else. That shape is a generation error now, so the slot can only mean the election.
      assert.strictEqual(media.label, "s3");
    });
  });

  describe("When reading the dogfood manifest's slot keys", () => {
    /**
     * Runtime parity for the slot-occupancy rule: the shadow-divergent shape cannot reach boot from
     * anything this tool generates, so `registerContractDefaultAliases` needs no branch that decides
     * between "the occupant" and "the electee" — they are the same registration whenever both exist.
     *
     * Asserted against the real generated manifest rather than a fixture, because the corner this
     * closes lived HERE: `buildMediaStorage` owned `mediaStorage` while `ioc.config` elected
     * `s3MediaStorage`, and the assertion two blocks up read "direct-contract" as though that were
     * the elected default.
     */
    it("should never register a slot-key occupant that is not the electee", () => {
      const groupRoots = Object.fromEntries(
        Object.entries(iocManifest as Record<string, unknown>).filter(
          ([key]) => !IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS.has(key),
        ),
      ) as IocGroupsManifest;
      const grouped = groupedContractNamesFromManifest(groupRoots);

      for (const [contractName, impls] of Object.entries(
        iocManifest.contracts,
      )) {
        if (grouped.has(contractName)) {
          continue;
        }
        const implList = Object.values(impls);
        const accessKey = resolveManifestAccessKey(contractName, implList);
        const occupant = implList.find(
          (meta) => meta.registrationKey === accessKey,
        );
        if (occupant === undefined) {
          continue;
        }
        const electedName = selectDefaultImplementationName(
          contractName,
          implList.map((meta) => ({
            implementationName: meta.implementationName,
            registrationKey: meta.registrationKey,
            ...(meta.default === true ? { default: true as const } : {}),
          })),
        );
        assert.strictEqual(
          occupant.implementationName,
          electedName,
          `${contractName}: ${occupant.implementationName} occupies slot key "${accessKey}" but ${electedName} is elected`,
        );
      }
    });
  });

  describe("When resolving named implementation registrations", () => {
    it("should resolve each registration key to its factory", async () => {
      const container = createContainer<IocGeneratedCradle>();
      registerIocFromManifest(container, [iocManifest]);
      const local = container.resolve("localMediaStorage") as MediaStorage;
      await local.put("k");
      assert.strictEqual(local.label, "local");
      const albumService = container.resolve("albumService") as {
        describe: () => string;
      };
      assert.match(albumService.describe(), /albums backed by s3/i);
    });
  });

  describe("When resolving a class registration unit from the dogfood manifest", () => {
    it("should construct the class with PROXY injection and wire its constructor dependency", async () => {
      const container = createContainer<IocGeneratedCradle>();
      registerIocFromManifest(container, [iocManifest]);

      const archive = container.resolve("archiveMediaStorage") as MediaStorage;
      assert.strictEqual(archive.label, "archive");
      assert.strictEqual(
        Object.getPrototypeOf(archive).constructor.name,
        "ArchiveMediaStorage",
      );
      await archive.put("k");
    });
  });

  describe("When resolving generated groups", () => {
    it("should register the group root and resolve its members through it", () => {
      const container = createContainer<IocGeneratedCradle>();
      registerIocFromManifest(container, [iocManifest]);

      // A record group: the value is keyed by contract, so every member is reachable — through the
      // group, which is the only way in. Neither member has a cradle key of its own.
      const channels = container.resolve("notificationChannels");
      assert.deepStrictEqual(Object.keys(channels).sort(), [
        "emailChannel",
        "smsChannel",
      ]);
      assert.strictEqual(channels.emailChannel.deliver("x"), "email:x");
      assert.strictEqual(channels.smsChannel.deliver("x"), "sms:x");
    });

    it("should register no contract-key alias for the grouped base", () => {
      const container = createContainer<IocGeneratedCradle>();
      registerIocFromManifest(container, [iocManifest]);

      // Grouped ⇒ group-only, and runtime mirrors it: the name the base's slot WOULD have had is
      // not registered, so nothing resolves under a key the emitted cradle does not carry.
      assert.throws(() =>
        (container as unknown as { resolve: (k: string) => unknown }).resolve(
          "notificationChannel",
        ),
      );
      // Member registration keys stay registered — the group resolver needs them.
      assert.ok(
        (container as unknown as { resolve: (k: string) => unknown }).resolve(
          "emailChannel",
        ),
      );
    });
  });

  describe("When opening a scope root from the dogfood manifest", () => {
    it("should resolve the emitted opener under its own key and nothing under the variant's", () => {
      const container = createContainer<IocGeneratedCradle>();
      registerIocFromManifest(container, [iocManifest]);

      // End to end on real generated output: the opener key came out of `ioc generate`, the
      // registration out of the manifest it wrote, and the type out of `ioc-registry.types.ts`.
      const open = container.resolve("openRequestReportScope");
      assert.strictEqual(typeof open, "function");
      // Opener-only: the scope-rooted contract claims no cradle key and elects no default.
      assert.strictEqual(container.hasRegistration("requestReport"), false);
    });

    it("should supply the declared late-bound value and resolve the variant eagerly", async () => {
      const container = createContainer<IocGeneratedCradle>();
      registerIocFromManifest(container, [iocManifest]);

      const opened = container.resolve("openRequestReportScope")({
        viewer: { id: "u_1" },
      });

      // `viewer` entered at the boundary; `mediaStorage` came from the container through the
      // parent chain. Exactly the split the declaration draws.
      assert.match(opened.requestReport.render(), /^report for u_1 backed by /);
      await opened.dispose();
      await opened.dispose();
    });
  });

  describe("When an ordinary registration injects the opener through its deps", () => {
    /**
     * The consumer pattern, end to end on real generated output: `buildReportGateway` types a deps
     * property as the emitted `OpenRequestReportScope` alias, generation resolved that to the
     * opener's own cradle key, and PROXY injection hands the registered opener to it here. The
     * pattern has to exist in the dogfood — `npm run typecheck` and this suite are what stop the
     * sanctioned form from regressing while every test still passes.
     */
    it("should resolve the gateway and let it open a scope per call", async () => {
      const container = createContainer<IocGeneratedCradle>();
      registerIocFromManifest(container, [iocManifest]);

      const gateway = container.resolve("reportGateway");

      assert.match(await gateway.renderFor("u_7"), /^report for u_7 backed by /);
      // Per call, not per container: a second call gets its own scope and its own lbv.
      assert.match(await gateway.renderFor("u_8"), /^report for u_8 backed by /);
    });

    it("should demand the opener under its own key and nothing else", () => {
      const container = createContainer<IocGeneratedCradle>();
      registerIocFromManifest(container, [iocManifest]);

      // The gateway resolves ONE key. If the opener alias had been read member-by-member instead of
      // carried by name, the deps type would have demanded the variant or its lbv here.
      assert.strictEqual(container.hasRegistration("openRequestReportScope"), true);
      assert.strictEqual(container.hasRegistration("requestReport"), false);
      assert.strictEqual(container.hasRegistration("dispose"), false);
    });
  });

  describe("When variants of one root diverge on a late-bound value", () => {
    /**
     * `viewer` is declared by the `requestReport` variant and consumed from the container by the
     * `publicReport` variant. Because some variant consumes it, the key stays in `IocExternals` and
     * the app registers it — which is the supply this test stands in for.
     */
    const bootWithExternalViewer = (): AwilixContainer<
      IocGeneratedCradle & IocExternals
    > => {
      // The composing app's own typing: the cradle it generated, plus the externals it promised.
      const container = createContainer<IocGeneratedCradle & IocExternals>();
      registerIocFromManifest(container, [iocManifest]);
      container.register({ viewer: asValue({ id: "container" }) });
      return container;
    };

    it("should resolve the container constant in the non-declaring variant's scope", async () => {
      const container = bootWithExternalViewer();

      // Empty lbv: everything this boundary needs comes through the parent chain. If the exclusion
      // union had removed `viewer` from `IocExternals`, nothing would have asked the app for it and
      // this would fail at resolution rather than at composition.
      //
      // Opened with NO argument: the variant declares no late-bound values, so the emitted opener
      // takes none. The typecheck probe below is the other half of that claim — this half is that
      // the registered closure really runs when called with nothing.
      const opened = container.resolve("openPublicReportScope")();

      assert.strictEqual(opened.publicReport.render(), "public report for container");
      await opened.dispose();
    });

    it("should let the declaring variant's opener shadow the container constant per open", async () => {
      const container = bootWithExternalViewer();

      const scoped = container.resolve("openRequestReportScope")({
        viewer: { id: "u_2" },
      });
      const inherited = container.resolve("openPublicReportScope")();

      // Same key, same container, two boundaries: one overrides per-open, the other inherits.
      assert.match(scoped.requestReport.render(), /^report for u_2 backed by /);
      assert.strictEqual(inherited.publicReport.render(), "public report for container");
      // …and the override is confined to its own scope — the container constant is untouched.
      assert.deepStrictEqual(container.resolve("viewer"), { id: "container" });

      await scoped.dispose();
      await inherited.dispose();
    });

    /**
     * The type half of the zero-argument claim, against the REAL generated types.
     *
     * The suite itself is not type-checked by `npm run typecheck` (test files are excluded), so a
     * call that stopped compiling would still run here. This probe compiles a file that imports the
     * generated registry types and asserts both directions: opening the empty-lbv boundary with no
     * argument is legal, and handing it one is not.
     */
    it("should type the empty-lbv opener as taking no argument", () => {
      const legal = typecheckAgainstGeneratedTypes(
        "const opened = open(); void opened.publicReport; void opened.dispose;",
      );
      assert.deepStrictEqual(
        legal.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")),
        [],
      );

      // Not merely optional: there is no parameter to pass, so passing one is an error. An lbv the
      // caller is free to invent is exactly the untyped scope-opening the opener exists to retire.
      const illegal = typecheckAgainstGeneratedTypes("void open({});");
      assert.strictEqual(illegal.length, 1);
      assert.match(
        ts.flattenDiagnosticMessageText(illegal[0]!.messageText, " "),
        /Expected 0 arguments/,
      );
    });
  });
});
