/**
 * Runtime registration of class units (schema v3): a `kind: "class"` implementation is constructed
 * with `new` and the cradle as its single argument (Awilix PROXY injection), and stays inside the
 * same manifest-aware resolution-error machinery as factory units. Also pins that schema v3 refuses
 * a v2 manifest outright.
 */
import assert from "node:assert";
import { describe, it } from "node:test";
import { createContainer } from "awilix";
import { registerIocFromManifest } from "./bootstrap.js";
import { isIocResolutionError } from "./iocResolutionError.js";
import { MANIFEST_SCHEMA_VERSION } from "../schemaVersion.js";
import { baseManifest, implMeta } from "../test-support/manifestFixtures.js";

type Logger = { log: (message: string) => string };
type Reporter = { report: () => string };

class ConsoleLogger implements Logger {
  log(message: string): string {
    return `log:${message}`;
  }
}

class AuditReporter implements Reporter {
  readonly #logger: Logger;

  constructor({ consoleLogger }: { consoleLogger: Logger }) {
    this.#logger = consoleLogger;
  }

  report(): string {
    return this.#logger.log("audit");
  }
}

class ThrowingUnit {
  constructor() {
    throw new Error("constructor blew up");
  }
}

class MissingDepUnit {
  constructor({ nowhere }: { nowhere: unknown }) {
    void nowhere;
  }
}

const classManifest = () =>
  baseManifest(
    {
      Logger: {
        consoleLogger: implMeta({
          contractName: "Logger",
          implementationName: "consoleLogger",
          exportName: "ConsoleLogger",
          kind: "class",
          default: true,
        }),
      },
      Reporter: {
        auditReporter: implMeta({
          contractName: "Reporter",
          implementationName: "auditReporter",
          exportName: "AuditReporter",
          kind: "class",
          default: true,
        }),
      },
    },
    [{ ConsoleLogger, AuditReporter }],
  );

describe("class unit registration", () => {
  describe("When a manifest entry declares kind: class", () => {
    it("should construct the class and inject its constructor deps through the cradle", () => {
      const container = createContainer<Record<string, unknown>>();
      registerIocFromManifest(container, [classManifest()]);

      const reporter = container.resolve("auditReporter") as Reporter;
      assert.ok(reporter instanceof AuditReporter);
      assert.strictEqual(reporter.report(), "log:audit");
    });

    it("should honor the declared lifetime like any factory registration", () => {
      const container = createContainer<Record<string, unknown>>();
      registerIocFromManifest(container, [classManifest()]);

      const a = container.resolve("consoleLogger");
      const b = container.resolve("consoleLogger");
      assert.strictEqual(a, b, "singleton class unit must be cached");
    });

    it("should resolve through the contract default-slot alias", () => {
      const container = createContainer<Record<string, unknown>>();
      registerIocFromManifest(container, [classManifest()]);

      const viaAlias = container.resolve("logger") as Logger;
      const viaKey = container.resolve("consoleLogger") as Logger;
      assert.strictEqual(viaAlias, viaKey);
    });
  });

  describe("When a class unit is registered but its export is not callable", () => {
    it("should report the missing export with the manifest location", () => {
      const container = createContainer<Record<string, unknown>>();
      const manifest = baseManifest(
        {
          Logger: {
            consoleLogger: implMeta({
              contractName: "Logger",
              implementationName: "consoleLogger",
              exportName: "ConsoleLogger",
              kind: "class",
              default: true,
            }),
          },
        },
        [{}],
      );

      assert.throws(
        () => registerIocFromManifest(container, [manifest]),
        /ConsoleLogger/,
      );
    });
  });

  describe("When a class constructor throws", () => {
    it("should surface an IocResolutionError naming the class unit", () => {
      const container = createContainer<Record<string, unknown>>();
      registerIocFromManifest(container, [
        baseManifest(
          {
            Broken: {
              throwingUnit: implMeta({
                contractName: "Broken",
                implementationName: "throwingUnit",
                exportName: "ThrowingUnit",
                kind: "class",
                default: true,
              }),
            },
          },
          [{ ThrowingUnit }],
        ),
      ]);

      assert.throws(
        () => container.resolve("throwingUnit"),
        (err: unknown) => {
          assert.ok(
            isIocResolutionError(err),
            "class construction failures must use the shared resolution-error machinery",
          );
          assert.strictEqual(err.failureType, "threw");
          assert.match(err.message, /Cannot build Broken using implementation throwingUnit/);
          assert.match(err.message, /constructor blew up/);
          return true;
        },
      );
    });
  });

  describe("When a class unit demands a key nothing registers", () => {
    it("should render a resolution chain naming the class unit", () => {
      const container = createContainer<Record<string, unknown>>();
      registerIocFromManifest(container, [
        baseManifest(
          {
            Missing: {
              missingDepUnit: implMeta({
                contractName: "Missing",
                implementationName: "missingDepUnit",
                exportName: "MissingDepUnit",
                kind: "class",
                default: true,
              }),
            },
          },
          [{ MissingDepUnit }],
        ),
      ]);

      assert.throws(
        () => container.resolve("missingDepUnit"),
        (err: unknown) => {
          assert.ok(isIocResolutionError(err));
          assert.match(err.message, /Missing \(missingDepUnit\)/);
          assert.match(err.message, /nowhere/);
          return true;
        },
      );
    });
  });

  describe("When a manifest omits kind", () => {
    it("should register it as a factory", () => {
      const container = createContainer<Record<string, unknown>>();
      registerIocFromManifest(container, [
        baseManifest(
          {
            Logger: {
              plainLogger: implMeta({
                contractName: "Logger",
                implementationName: "plainLogger",
                exportName: "buildPlainLogger",
                default: true,
              }),
            },
          },
          [{ buildPlainLogger: (): Logger => ({ log: (m) => `plain:${m}` }) }],
        ),
      ]);

      const logger = container.resolve("plainLogger") as Logger;
      assert.strictEqual(logger.log("x"), "plain:x");
    });
  });

  describe("When a manifest declares the previous schema version", () => {
    it("should refuse it rather than composing across versions", () => {
      const container = createContainer<Record<string, unknown>>();
      const v2Manifest = {
        ...baseManifest({}),
        manifestSchemaVersion: 2 as unknown as typeof MANIFEST_SCHEMA_VERSION,
      };

      assert.throws(
        () => registerIocFromManifest(container, [v2Manifest]),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /Manifest schema version mismatch/);
          assert.match(err.message, /Runtime expects: 3/);
          assert.match(err.message, /Got: 2 from manifest at index 0/);
          return true;
        },
      );
    });
  });
});
