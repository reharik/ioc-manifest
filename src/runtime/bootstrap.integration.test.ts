import assert from "node:assert";
import { describe, it } from "node:test";
import { asValue, createContainer, type AwilixContainer } from "awilix";
import type { MediaStorage } from "../examples/b-multiple-implementations.js";
import type {
  IocExternals,
  IocGeneratedCradle,
} from "../generated/ioc-registry.types.js";
import { iocManifest } from "../generated/ioc-manifest.js";
import { registerIocFromManifest } from "./bootstrap.js";

describe("registerIocFromManifest", () => {
  describe("When resolving the contract default slot", () => {
    it("should resolve to the selected default implementation", async () => {
      const container = createContainer<IocGeneratedCradle>();
      registerIocFromManifest(container, [iocManifest]);
      const media = container.resolve("mediaStorage") as MediaStorage;
      await media.put("k");
      assert.strictEqual(media.label, "direct-contract");
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
      assert.match(albumService.describe(), /albums backed by direct-contract/i);
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
    it("should register group roots and resolve collection members from the cradle", () => {
      const container = createContainer<IocGeneratedCradle>();
      registerIocFromManifest(container, [iocManifest]);

      const mediaGroup = container.resolve("mediaStoragesGroup") as MediaStorage[];
      assert.ok(Array.isArray(mediaGroup));
      assert.strictEqual(mediaGroup.length, 3);
      const labels = mediaGroup.map((m) => m.label).sort();
      assert.deepStrictEqual(labels, ["archive", "local", "s3"]);
      assert.ok(
        new Set(mediaGroup.map((m) => m.label)).size === mediaGroup.length,
        "collection group should not duplicate implementations",
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
      const opened = container.resolve("openPublicReportScope")({});

      assert.strictEqual(opened.publicReport.render(), "public report for container");
      await opened.dispose();
    });

    it("should let the declaring variant's opener shadow the container constant per open", async () => {
      const container = bootWithExternalViewer();

      const scoped = container.resolve("openRequestReportScope")({
        viewer: { id: "u_2" },
      });
      const inherited = container.resolve("openPublicReportScope")({});

      // Same key, same container, two boundaries: one overrides per-open, the other inherits.
      assert.match(scoped.requestReport.render(), /^report for u_2 backed by /);
      assert.strictEqual(inherited.publicReport.render(), "public report for container");
      // …and the override is confined to its own scope — the container constant is untouched.
      assert.deepStrictEqual(container.resolve("viewer"), { id: "container" });

      await scoped.dispose();
      await inherited.dispose();
    });
  });
});
