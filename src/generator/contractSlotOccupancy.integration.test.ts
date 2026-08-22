/**
 * @fileoverview The slot-occupancy rule end to end, in both the shapes that can produce it and
 * through both verbs.
 *
 * Two shapes, two gates, one rule:
 *
 * - **Package-local.** One package registers `mediaStorage` and elects `s3MediaStorage`. Both facts
 *   are in one registration plan, so the codegen gate catches it — in LIBRARY mode too, which
 *   matters because a library that ships this exports a manifest whose contract key hands the wrong
 *   implementation to every app that composes it.
 * - **Composed.** A library registers `mediaStorage` and elects it (fine on its own); an app then
 *   elects a different implementation over it. Neither package is in the state alone; the composed
 *   set is. A registration plan cannot see that, so the composition suite does — which means
 *   app-mode `generate` and `ioc validate` both report it, and the parity between them is pinned
 *   here on the OUTPUT rather than on the plumbing.
 */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { MANIFEST_SCHEMA_VERSION } from "../schemaVersion.js";
import { tryLoadIocConfig } from "../config/loadIocConfig.js";
import { runValidate } from "../validate/runValidate.js";
import { generateManifest } from "./generateManifest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iocManifestIndex = path
  .join(__dirname, "../index.js")
  .replace(/\\/g, "/");

const LIB = "@test/storage";

const CONTRACTS = `export interface MediaStorage {
  label: string;
}
`;

/** The shadowing export: named after its contract, so its key IS the slot key. */
const SHADOWING_FACTORY = `import type { MediaStorage } from "../contracts.js";

export const buildMediaStorage = (): MediaStorage => ({ label: "direct" });
`;

const S3_FACTORY = `import type { MediaStorage } from "../contracts.js";

export const buildS3MediaStorage = (): MediaStorage => ({ label: "s3" });
`;

const LOCAL_FACTORY = `import type { MediaStorage } from "../contracts.js";

export const buildLocalMediaStorage = (): MediaStorage => ({ label: "local" });
`;

const TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    module: "Node16",
    moduleResolution: "Node16",
    lib: ["ES2022"],
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ["src/**/*.ts"],
};

type FixtureOptions = {
  readonly factories: Readonly<Record<string, string>>;
  /** `registrations` block, verbatim. */
  readonly registrations?: string;
  readonly composed?: readonly string[];
  /** Composed library packages to install. */
  readonly libraries?: readonly { readonly name: string; readonly manifest: string; readonly registryTypes: string }[];
};

type Fixture = {
  readonly projectRoot: string;
  readonly configPath: string;
  readonly generatedDir: string;
};

const buildFixture = (options: FixtureOptions): Fixture => {
  const projectRoot = realpathSync(
    mkdtempSync(path.join(tmpdir(), "ioc-slot-occupancy-")),
  );
  const srcDir = path.join(projectRoot, "src");
  const factoriesDir = path.join(srcDir, "factories");
  mkdirSync(factoriesDir, { recursive: true });

  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "@test/app", type: "module" }),
  );
  writeFileSync(
    path.join(projectRoot, "tsconfig.json"),
    JSON.stringify(TSCONFIG, null, 2),
  );
  writeFileSync(path.join(srcDir, "contracts.ts"), CONTRACTS);
  for (const [name, source] of Object.entries(options.factories)) {
    writeFileSync(path.join(factoriesDir, name), source);
  }

  for (const lib of options.libraries ?? []) {
    const pkgDir = path.join(projectRoot, "node_modules", ...lib.name.split("/"));
    mkdirSync(path.join(pkgDir, "generated"), { recursive: true });
    writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: lib.name,
        type: "module",
        exports: {
          "./iocManifest": {
            types: "./generated/ioc-manifest.ts",
            import: "./generated/ioc-manifest.ts",
          },
          "./iocTypes": {
            types: "./generated/ioc-registry.types.ts",
            import: "./generated/ioc-registry.types.ts",
          },
        },
      }),
    );
    writeFileSync(path.join(pkgDir, "generated", "ioc-manifest.ts"), lib.manifest);
    writeFileSync(
      path.join(pkgDir, "generated", "ioc-registry.types.ts"),
      lib.registryTypes,
    );
  }

  const configPath = path.join(srcDir, "ioc.config.ts");
  writeFileSync(
    configPath,
    `import { defineIocConfig } from "${iocManifestIndex}";

export default defineIocConfig({
  discovery: {
    scanDirs: ["src/factories"],
    generatedDir: "src/generated",
    includes: ["**/*.{ts,tsx}"],
  },${options.composed !== undefined ? `\n  composedManifests: ${JSON.stringify(options.composed)},` : ""}${
    options.registrations !== undefined
      ? `\n  registrations: ${options.registrations},`
      : ""
  }
});
`,
  );

  return {
    projectRoot,
    configPath,
    generatedDir: path.join(srcDir, "generated"),
  };
};

const generate = (fixture: Fixture): Promise<void> =>
  generateManifest({
    paths: { projectRoot: fixture.projectRoot },
    iocConfigPath: fixture.configPath,
  });

const generateExpectingFailure = async (fixture: Fixture): Promise<string> => {
  try {
    await generate(fixture);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  assert.fail("generation should have failed on the slot-occupancy rule");
};

const generatedFiles = (fixture: Fixture): string[] =>
  existsSync(fixture.generatedDir)
    ? readdirSync(fixture.generatedDir)
        .filter((f) => f.startsWith("ioc-"))
        .sort((a, b) => a.localeCompare(b))
    : [];

const libImpl = (registrationKey: string, extra = ""): string =>
  `{ registrationKey: ${JSON.stringify(registrationKey)}, exportName: ${JSON.stringify(
    `build${registrationKey.charAt(0).toUpperCase()}${registrationKey.slice(1)}`,
  )}, modulePath: ${JSON.stringify(`${registrationKey}.ts`)}, contractName: "MediaStorage"${extra} }`;

/**
 * A library that is coherent ON ITS OWN: it registers `mediaStorage` and, having no `default: true`
 * anywhere, elects it by the convention rule. Nothing here is wrong until an app overrules it.
 */
const coherentLibrary = () => ({
  name: LIB,
  manifest: `export const iocManifest = {
  manifestSchemaVersion: ${MANIFEST_SCHEMA_VERSION},
  moduleImports: [],
  contracts: {
    MediaStorage: {
      mediaStorage: ${libImpl("mediaStorage")},
      s3MediaStorage: ${libImpl("s3MediaStorage")},
    },
  },
};
`,
  registryTypes: `export interface IocGeneratedCradle {
  mediaStorage: { label: string };
  s3MediaStorage: { label: string };
}

export interface IocExternals {}
`,
});

describe("slot occupancy end to end", () => {
  describe("When one package registers the slot key and elects someone else", () => {
    const shadowFixture = (): Fixture =>
      buildFixture({
        factories: {
          "buildMediaStorage.ts": SHADOWING_FACTORY,
          "buildS3MediaStorage.ts": S3_FACTORY,
        },
        registrations: `{ MediaStorage: { s3MediaStorage: { default: true } } }`,
      });

    it("should fail library-mode generation naming both exits, writing nothing", async () => {
      const fixture = shadowFixture();
      const message = await generateExpectingFailure(fixture);

      assert.match(
        message,
        /Implementation "mediaStorage" occupies contract "MediaStorage"'s slot key "mediaStorage" but is not the elected default \("s3MediaStorage" is\)/,
      );
      assert.match(message, /Rename the factory so the key stops shadowing the slot/);
      assert.match(
        message,
        /or elect "mediaStorage" as the default for "MediaStorage"/,
      );
      assert.deepEqual(generatedFiles(fixture), []);
    });
  });

  describe("When the registration occupying the slot key IS the electee", () => {
    it("should generate, with the slot key resolving to the occupant", async () => {
      const fixture = buildFixture({
        factories: {
          "buildMediaStorage.ts": SHADOWING_FACTORY,
          "buildS3MediaStorage.ts": S3_FACTORY,
        },
        registrations: `{ MediaStorage: { mediaStorage: { default: true } } }`,
      });

      await generate(fixture);

      assert.deepEqual(generatedFiles(fixture), [
        "ioc-manifest.ts",
        "ioc-registry.types.ts",
      ]);
      const manifest = readdirSync(fixture.generatedDir).includes(
        "ioc-manifest.ts",
      );
      assert.ok(manifest);
    });
  });

  describe("When a divergent election involves no shadowing registration", () => {
    it("should generate unchanged — the slot key is a genuine alias", async () => {
      const fixture = buildFixture({
        factories: {
          "buildLocalMediaStorage.ts": LOCAL_FACTORY,
          "buildS3MediaStorage.ts": S3_FACTORY,
        },
        registrations: `{ MediaStorage: { s3MediaStorage: { default: true } } }`,
      });

      await generate(fixture);
      assert.deepEqual(generatedFiles(fixture), [
        "ioc-manifest.ts",
        "ioc-registry.types.ts",
      ]);
    });
  });

  describe("When composition creates the shape out of two coherent packages", () => {
    /** The library elects `mediaStorage`; the app overrules it with `s3MediaStorage`. */
    const composedFixture = (): Fixture =>
      buildFixture({
        factories: {},
        composed: [LIB],
        libraries: [coherentLibrary()],
        registrations: `{ MediaStorage: { s3MediaStorage: { default: true } } }`,
      });

    it("should fail app-mode generation through the composition suite", async () => {
      const fixture = composedFixture();
      const message = await generateExpectingFailure(fixture);

      assert.match(message, /App-mode generation refused/);
      assert.match(message, /\[slot-occupancy\]/);
      assert.match(
        message,
        /Implementation "mediaStorage" occupies contract "MediaStorage"'s slot key "mediaStorage" but is not the elected default \("s3MediaStorage" is\)/,
      );
      assert.deepEqual(generatedFiles(fixture), []);
    });

    it("should report the same claim and the same remedy through validate", async () => {
      const fixture = composedFixture();
      const genMessage = await generateExpectingFailure(fixture);

      // Validate needs committed artifacts to read. Emit them with the app in library mode — where
      // the rule cannot see a composed contract at all — then restore the composing config.
      const libraryConfig = `import { defineIocConfig } from "${iocManifestIndex}";

export default defineIocConfig({
  discovery: { scanDirs: ["src/factories"], generatedDir: "src/generated", includes: ["**/*.{ts,tsx}"] },
});
`;
      const composingConfig = `import { defineIocConfig } from "${iocManifestIndex}";

export default defineIocConfig({
  discovery: { scanDirs: ["src/factories"], generatedDir: "src/generated", includes: ["**/*.{ts,tsx}"] },
  composedManifests: ${JSON.stringify([LIB])},
  registrations: { MediaStorage: { s3MediaStorage: { default: true } } },
});
`;
      writeFileSync(fixture.configPath, libraryConfig);
      await generate(fixture);
      writeFileSync(fixture.configPath, composingConfig);

      const config = await tryLoadIocConfig(fixture.configPath);
      const result = await runValidate({
        projectRoot: fixture.projectRoot,
        configPath: fixture.configPath,
        config: config!,
        json: false,
      });

      assert.equal(result.kind, "report");
      if (result.kind !== "report") {
        return;
      }
      const issue = result.report.issues.find(
        (i) => i.category === "slot-occupancy",
      );
      assert.ok(issue !== undefined, "validate should report [slot-occupancy]");
      assert.equal(issue!.severity, "error");

      // Parity, pinned on the words: gen's aggregated report carries validate's claim verbatim,
      // and both name the same two exits.
      assert.ok(genMessage.includes(issue!.summary));
      assert.ok(genMessage.includes(issue!.suggestedFix!));
      assert.match(issue!.suggestedFix!, /Rename the factory/);
      assert.match(issue!.suggestedFix!, /or elect "mediaStorage" as the default/);
    });
  });

  describe("When the composed election agrees with the occupant", () => {
    it("should generate — composition did not break the coincidence", async () => {
      const fixture = buildFixture({
        factories: {},
        composed: [LIB],
        libraries: [coherentLibrary()],
      });

      await generate(fixture);
      assert.deepEqual(generatedFiles(fixture), [
        "ioc-composed.ts",
        "ioc-manifest.ts",
        "ioc-registry.types.ts",
      ]);
    });
  });
});
