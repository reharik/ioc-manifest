/**
 * Awilix strict mode is the default runtime, and what that costs and buys.
 *
 * Strict is Awilix's runtime correctness net: a longer-lived unit holding a shorter-lived
 * dependency throws at first resolve instead of quietly freezing the first instance it was handed.
 * Turning it on by default puts the runtime one notch STRICTER than our static model, which ranks
 * `singleton → transient` and `scoped → transient` as warnings. That gap is deliberate and
 * documented; the fixture below pins it as behaviour rather than leaving it as prose.
 *
 * The rest of these are compatibility pins. Three of our registration shapes are transient for
 * reasons that have nothing to do with how long their values live — contract slot aliases, group
 * roots, and scope-root openers — and a naive strict container would refuse all three. They are
 * marked leak-safe; these tests are what stops that from being quietly undone.
 */
import assert from "node:assert";
import { describe, it } from "node:test";
import { createContainer } from "awilix";
import type {
  IocModuleNamespace,
  IocRegisterableManifest,
} from "../core/manifest.js";
import { MANIFEST_SCHEMA_VERSION } from "../schemaVersion.js";
import { registerIocFromManifest } from "./bootstrap.js";
import { isIocResolutionError } from "./iocResolutionError.js";

type Ticket = { readonly serial: number };
type Holder = { ticket: Ticket };
type Logger = { readonly id: string };
type Report = { render: () => string };

let tickets = 0;

const moduleImports: readonly IocModuleNamespace[] = [
  {
    buildTicket: (): Ticket => {
      tickets += 1;
      return { serial: tickets };
    },
    /* A SINGLETON holding a TRANSIENT: statically a warning, and an error under strict. */
    buildHolder: ({ ticket }: { ticket: Ticket }): Holder => ({ ticket }),
    /* Same edge, reached through the contract's default slot key rather than the impl key. */
    buildSlotHolder: ({ ticket }: { ticket: Ticket }): Holder => ({ ticket }),

    buildFileLogger: (): Logger => ({ id: "fileLogger" }),
    buildAuditLogger: (): Logger => ({ id: "auditLogger" }),
    /* A singleton consuming a GROUP root — group roots are transient by registration. */
    buildLogFanout: ({ loggers }: { loggers: readonly Logger[] }): Holder => ({
      ticket: { serial: loggers.length },
    }),
    /* A group member with a bad DIRECT edge of its own: singleton member, transient dep. */
    buildLeakyLogger: ({ ticket }: { ticket: Ticket }): Logger => ({
      id: `leaky:${ticket.serial}`,
    }),

    buildReport: ({ viewer }: { viewer: { id: string } }): Report => ({
      render: () => `report:${viewer.id}`,
    }),
    /* A singleton consuming an OPENER — openers are transient by registration. */
    buildGateway: ({
      openReportScope,
    }: {
      openReportScope: (lbv: { viewer: { id: string } }) => {
        report: Report;
        dispose: () => Promise<void>;
      };
    }): { run: (id: string) => Promise<string> } => ({
      run: async (id) => {
        const opened = openReportScope({ viewer: { id } });
        const rendered = opened.report.render();
        await opened.dispose();
        return rendered;
      },
    }),
  },
];

const row = (
  exportName: string,
  registrationKey: string,
  contractName: string,
  lifetime: "singleton" | "scoped" | "transient",
  extra?: Record<string, unknown>,
): Record<string, unknown> => ({
  [registrationKey]: {
    exportName,
    registrationKey,
    modulePath: `${registrationKey}.ts`,
    relImport: `../${registrationKey}.js`,
    contractName,
    implementationName: registrationKey,
    lifetime,
    moduleIndex: 0,
    ...extra,
  },
});

const manifest = (
  overrides?: Partial<IocRegisterableManifest>,
): IocRegisterableManifest => ({
  manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
  moduleImports,
  contracts: {
    /* `default: true` with a registration key unlike the contract's access key is what makes
       bootstrap write the `aliasTo` slot — the shape the slot-key pins below need. */
    Ticket: row("buildTicket", "ticket", "Ticket", "transient", {
      default: true,
    }),
    Holder: row("buildHolder", "holder", "Holder", "singleton"),
  },
  ...overrides,
});

const boot = (
  m: IocRegisterableManifest = manifest(),
  options?: { strict?: boolean },
): ReturnType<typeof createContainer<Record<string, unknown>>> => {
  const container = createContainer<Record<string, unknown>>({
    injectionMode: "PROXY",
  });
  registerIocFromManifest(container, [m], undefined, options);
  return container;
};

/**
 * A strict lifetime-leak failure, as a consumer meets it.
 *
 * Awilix throws its own `AwilixResolutionError`, but it does so while our instrumented factory path
 * is on the stack, so it arrives normalized: an {@link IocResolutionError} with failure type
 * `lifetime` and the manifest-aware chain. Strict mode gets the same reporting every other
 * resolution failure gets, for free.
 */
const lifetimeLeakMessage = (run: () => unknown): string => {
  try {
    run();
  } catch (error: unknown) {
    assert.ok(
      isIocResolutionError(error),
      `expected an IocResolutionError, got ${String(error)}`,
    );
    assert.strictEqual(error.failureType, "lifetime");
    return error.message;
  }
  return assert.fail("expected the resolve to throw");
};

describe("Awilix strict mode", () => {
  describe("When registerIocFromManifest is called with no options", () => {
    it("should turn strict on", () => {
      assert.strictEqual(boot().options.strict, true);
    });

    it("should carry strict into scopes opened afterwards", () => {
      assert.strictEqual(boot().createScope().options.strict, true);
    });
  });

  describe("When the caller opts out with strict: false", () => {
    it("should leave strict off", () => {
      assert.strictEqual(
        boot(manifest(), { strict: false }).options.strict,
        false,
      );
    });

    it("should override a container created with strict: true", () => {
      const container = createContainer<Record<string, unknown>>({
        injectionMode: "PROXY",
        strict: true,
      });
      registerIocFromManifest(container, [manifest()], undefined, {
        strict: false,
      });
      assert.strictEqual(container.options.strict, false);
    });
  });

  describe("When a singleton holds a transient — the statically WARNED shape", () => {
    it("should throw at first resolve under the default runtime", () => {
      const message = lifetimeLeakMessage(() => boot().resolve("holder"));

      assert.match(
        message,
        /✖ dependency lifetime is shorter than an ancestor \(strict mode\)/,
      );
      assert.match(
        message,
        /Cannot build Holder using implementation holder\./,
      );
      assert.match(message, /Ticket \(ticket\)/);
    });

    it("should throw through the contract's default slot key just the same", () => {
      /* `aliasTo` is itself leak-safe, but it re-enters resolution for its target, and the target
         is checked — so both spellings of the same edge fail the same way. */
      /* `transientTicket` is the registration key; `ticket` is contract `Ticket`'s access key, so
         bootstrap writes `ticket -> aliasTo("transientTicket")` and the demand goes through it. */
      const container = boot(
        manifest({
          contracts: {
            Ticket: row(
              "buildTicket",
              "transientTicket",
              "Ticket",
              "transient",
              { default: true },
            ),
            Holder: row("buildSlotHolder", "slotHolder", "Holder", "singleton"),
          },
        }),
      );

      const message = lifetimeLeakMessage(() =>
        container.resolve("slotHolder"),
      );
      assert.match(
        message,
        /✖ dependency lifetime is shorter than an ancestor \(strict mode\)/,
      );
    });

    it("should resolve under the opt-out, which is the whole point of having one", () => {
      const container = boot(manifest(), { strict: false });

      const holder = container.resolve("holder") as Holder;
      assert.strictEqual(typeof holder.ticket.serial, "number");
    });
  });

  describe("When a contract default slot has no inversion", () => {
    it("should resolve through the aliasTo under strict", () => {
      const container = boot(
        manifest({
          contracts: {
            Ticket: row(
              "buildTicket",
              "singletonTicket",
              "Ticket",
              "singleton",
              { default: true },
            ),
          },
        }),
      );

      /* `ticket` is the slot key, `singletonTicket` the registration key it aliases. */
      assert.strictEqual(
        container.resolve("ticket"),
        container.resolve("singletonTicket"),
      );
    });
  });

  describe("When a singleton consumes a group root", () => {
    const grouped = (
      memberRows: Record<string, unknown>,
    ): IocRegisterableManifest => ({
      manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
      moduleImports,
      contracts: {
        LogFanout: row("buildLogFanout", "logFanout", "LogFanout", "singleton"),
        ...memberRows,
      },
      loggers: {
        kind: "collection" as const,
        baseType: "Logger",
        baseTypeId: "/fake/logger.ts:Logger",
        members: [
          { contractName: "FileLogger", registrationKey: "fileLogger" },
          { contractName: "AuditLogger", registrationKey: "auditLogger" },
        ],
      },
    });

    it("should resolve — a group root's transient lifetime is a registration detail, not a leak", () => {
      const container = boot(
        grouped({
          FileLogger: row(
            "buildFileLogger",
            "fileLogger",
            "FileLogger",
            "singleton",
          ),
          AuditLogger: row(
            "buildAuditLogger",
            "auditLogger",
            "AuditLogger",
            "singleton",
          ),
        }),
      );

      const fanout = container.resolve("logFanout") as Holder;
      assert.strictEqual(fanout.ticket.serial, 2);
    });

    it("should still strict-check a MEMBER's own direct edges when it is read", () => {
      /* The group hop itself is invisible to strict — the read happens outside any enclosing
         resolve — but reading a member starts its own resolution stack, so the member's own bad
         edge is caught exactly as a direct resolve of it would be. */
      const container = boot({
        manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
        moduleImports,
        contracts: {
          Ticket: row("buildTicket", "ticket", "Ticket", "transient"),
          LeakyLogger: row(
            "buildLeakyLogger",
            "leakyLogger",
            "LeakyLogger",
            "singleton",
          ),
        },
        loggers: {
          kind: "collection" as const,
          baseType: "Logger",
          baseTypeId: "/fake/logger.ts:Logger",
          members: [
            { contractName: "LeakyLogger", registrationKey: "leakyLogger" },
          ],
        },
      });

      const loggers = container.resolve("loggers") as readonly Logger[];

      const message = lifetimeLeakMessage(() => loggers[0]);
      assert.match(
        message,
        /✖ dependency lifetime is shorter than an ancestor \(strict mode\)/,
      );
      assert.match(message, /LeakyLogger \(leakyLogger\)/);
      /* The `(group)` hop is still in the chain — the member was reached through the group. */
      assert.match(message, /loggers \(group\)/);
    });
  });

  describe("When a scope-root opener is used under strict", () => {
    const withOpener: IocRegisterableManifest = {
      manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
      moduleImports,
      contracts: {
        Gateway: row("buildGateway", "gateway", "Gateway", "singleton"),
      },
      scopeRoots: {
        Report: {
          report: {
            exportName: "buildReport",
            openerKey: "openReportScope",
            variantKey: "report",
            contractName: "Report",
            variantName: "report",
            modulePath: "report.ts",
            relImport: "../report.js",
            lbvKeys: ["viewer"],
            moduleIndex: 0,
          },
        },
      },
    };

    it("should create the scope, register the late-bound value, and resolve the variant", async () => {
      const open = boot(withOpener).resolve("openReportScope") as (lbv: {
        viewer: { id: string };
      }) => { report: Report; dispose: () => Promise<void> };

      const opened = open({ viewer: { id: "u1" } });
      assert.strictEqual(opened.report.render(), "report:u1");
      await opened.dispose();
    });

    it("should inject into a singleton — an opener holds nothing that could leak", async () => {
      const gateway = boot(withOpener).resolve("gateway") as {
        run: (id: string) => Promise<string>;
      };

      assert.strictEqual(await gateway.run("u2"), "report:u2");
    });
  });
});
