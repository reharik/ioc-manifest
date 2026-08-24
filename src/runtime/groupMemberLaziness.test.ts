/**
 * Group member properties resolve lazily, and the sanctioned consumption pattern therefore works.
 *
 * Grouped ⇒ group-only makes the group the ONLY road from one member to a sibling. Building group
 * values eagerly put the group on Awilix's resolution stack while its members were constructed, so
 * a member that named the group — the exact thing the grouped-member error instructs — closed a
 * loop that the dependency graph does not contain. These tests pin the road as open, the scope and
 * instance identity laziness has to preserve to be a fix rather than a dodge, and the one failure
 * that is still a real cycle.
 *
 * Manifest rows are written by hand: the behaviour under test is the runtime's, not the generator's.
 */
import assert from "node:assert";
import { beforeEach, describe, it } from "node:test";
import { createContainer, type AwilixContainer } from "awilix";
import type {
  IocModuleNamespace,
  IocRegisterableManifest,
} from "../core/manifest.js";
import { MANIFEST_SCHEMA_VERSION } from "../schemaVersion.js";
import { registerIocFromManifest } from "./bootstrap.js";
import { isIocResolutionError } from "./iocResolutionError.js";

type Reaction = { readonly serial: number; react: () => string };
type Comment = {
  readonly serial: number;
  add: () => string;
  sibling: () => Reaction;
};
type WriteServices = { addComment: Comment; toggleReaction: Reaction };
type WriteContext = { viewer: { id: string }; services: WriteServices };
type Logger = {
  readonly serial: number;
  readonly kind: string;
  log: () => string;
};

const builds = { addComment: 0, toggleReaction: 0, loggers: 0 };

const moduleImports: readonly IocModuleNamespace[] = [
  {
    buildToggleReaction: (): Reaction => {
      builds.toggleReaction += 1;
      return { serial: builds.toggleReaction, react: () => "reacted" };
    },

    /* The sanctioned shape: destructure the GROUP at construction, read the member at call time. */
    buildAddComment: ({
      writeServices,
    }: {
      writeServices: WriteServices;
    }): Comment => {
      builds.addComment += 1;
      return {
        serial: builds.addComment,
        add: () => `added+${writeServices.toggleReaction.react()}`,
        sibling: () => writeServices.toggleReaction,
      };
    },

    buildWriteContext: ({
      writeServices,
      viewer,
    }: {
      writeServices: WriteServices;
      viewer: { id: string };
    }): WriteContext => ({ viewer, services: writeServices }),

    /* Reads its OWN slot through the group while it is being built: a real cycle. */
    buildSelfReadingComment: ({
      writeServices,
    }: {
      writeServices: WriteServices;
    }): Comment => {
      const self = writeServices.addComment;
      return {
        serial: 0,
        add: () => `self:${self.serial}`,
        sibling: () => writeServices.toggleReaction,
      };
    },

    /* Reads a SIBLING at construction; the sibling reads back. Also a real cycle. */
    buildEagerSiblingComment: ({
      writeServices,
    }: {
      writeServices: WriteServices;
    }): Comment => {
      const sibling = writeServices.toggleReaction;
      return {
        serial: 0,
        add: () => sibling.react(),
        sibling: () => sibling,
      };
    },
    buildEagerSiblingReaction: ({
      writeServices,
    }: {
      writeServices: WriteServices;
    }): Reaction => {
      const back = writeServices.addComment;
      return { serial: 0, react: () => `back:${back.serial}` };
    },
  },
];

const writeServicesGroup = {
  kind: "object" as const,
  baseType: "WriteService",
  baseTypeId: "/fake/writeService.ts:WriteService",
  members: {
    addComment: { contractName: "AddComment", registrationKey: "addComment" },
    toggleReaction: {
      contractName: "ToggleReaction",
      registrationKey: "toggleReaction",
    },
  },
};

const contractRow = (
  exportName: string,
  registrationKey: string,
  contractName: string,
): Record<string, unknown> => ({
  [registrationKey]: {
    exportName,
    registrationKey,
    modulePath: `${registrationKey}.ts`,
    relImport: `../${registrationKey}.js`,
    contractName,
    implementationName: registrationKey,
    lifetime: "scoped" as const,
    moduleIndex: 0,
  },
});

const manifest = (
  overrides?: Partial<IocRegisterableManifest>,
): IocRegisterableManifest => ({
  manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
  moduleImports,
  contracts: {
    AddComment: contractRow("buildAddComment", "addComment", "AddComment"),
    ToggleReaction: contractRow(
      "buildToggleReaction",
      "toggleReaction",
      "ToggleReaction",
    ),
  },
  writeServices: writeServicesGroup,
  scopeRoots: {
    WriteContext: {
      authenticatedWriteGraphQlContext: {
        exportName: "buildWriteContext",
        openerKey: "openWriteScope",
        variantKey: "authenticatedWriteGraphQlContext",
        contractName: "WriteContext",
        variantName: "authenticatedWriteGraphQlContext",
        modulePath: "writeContext.ts",
        relImport: "../writeContext.js",
        lbvKeys: ["viewer"],
        moduleIndex: 0,
      },
    },
  },
  ...overrides,
});

const boot = (
  m: IocRegisterableManifest = manifest(),
): AwilixContainer<Record<string, unknown>> => {
  const container = createContainer<Record<string, unknown>>({
    injectionMode: "PROXY",
  });
  registerIocFromManifest(container, [m]);
  return container;
};

const messageOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error: unknown) {
    assert.ok(
      isIocResolutionError(error),
      `expected an IocResolutionError, got ${String(error)}`,
    );
    return error.message;
  }
  return assert.fail("expected the resolution to throw");
};

beforeEach(() => {
  builds.addComment = 0;
  builds.toggleReaction = 0;
  builds.loggers = 0;
});

describe("group member laziness", () => {
  describe("When a scope root reaches a record group whose member consumes its sibling through the group", () => {
    it("should resolve the whole chain under an opened scope", async () => {
      const open = boot().resolve("openWriteScope") as (lbv: {
        viewer: { id: string };
      }) => { authenticatedWriteGraphQlContext: WriteContext } & {
        dispose: () => Promise<void>;
      };

      const opened = open({ viewer: { id: "u1" } });
      const ctx = opened.authenticatedWriteGraphQlContext;

      /* The field chain, end to end:
         authenticatedWriteGraphQlContext -> writeServices -> addComment -> writeServices. */
      assert.strictEqual(ctx.services.addComment.add(), "added+reacted");

      await opened.dispose();
    });

    it("should hand the member the same sibling instance the scope's cradle would", async () => {
      const open = boot().resolve("openWriteScope") as (lbv: {
        viewer: { id: string };
      }) => { authenticatedWriteGraphQlContext: WriteContext } & {
        dispose: () => Promise<void>;
      };

      const opened = open({ viewer: { id: "u1" } });
      const ctx = opened.authenticatedWriteGraphQlContext;

      /* `addComment` captured its OWN group value (group roots are transient), so this is only the
         same object if the captured cradle is the opened scope's — the identity laziness has to
         preserve to be a fix rather than a way of deferring the same bug. */
      assert.strictEqual(
        ctx.services.addComment.sibling(),
        ctx.services.toggleReaction,
      );
      assert.strictEqual(builds.toggleReaction, 1);

      await opened.dispose();
    });
  });

  describe("When a member destructures the group at construction without reading a member", () => {
    it("should construct no siblings — the group value is inert", () => {
      const scope = boot().createScope();
      const group = scope.resolve("writeServices") as WriteServices;

      const comment = group.addComment;

      assert.strictEqual(builds.addComment, 1);
      assert.strictEqual(
        builds.toggleReaction,
        0,
        "destructuring the group must not build its members",
      );
      assert.strictEqual(comment.add(), "added+reacted");
      assert.strictEqual(builds.toggleReaction, 1);
    });

    it("should resolve no members at all when only the group is resolved", () => {
      const scope = boot().createScope();

      scope.resolve("writeServices");

      assert.deepStrictEqual(
        {
          addComment: builds.addComment,
          toggleReaction: builds.toggleReaction,
        },
        { addComment: 0, toggleReaction: 0 },
      );
    });
  });

  describe("When a member reads a member property during its own construction", () => {
    const selfReading = (): IocRegisterableManifest =>
      manifest({
        contracts: {
          AddComment: {
            ...contractRow(
              "buildSelfReadingComment",
              "addComment",
              "AddComment",
            ),
          },
          ToggleReaction: contractRow(
            "buildToggleReaction",
            "toggleReaction",
            "ToggleReaction",
          ),
        },
      });

    it("should still fail — it is a real cycle, not one manufactured by eager building", () => {
      const scope = boot(selfReading()).createScope();
      const message = messageOf(
        () => (scope.resolve("writeServices") as WriteServices).addComment,
      );

      assert.match(message, /cyclic dependency detected/);
    });

    it("should keep the group hop legible in the chain", () => {
      const scope = boot(selfReading()).createScope();
      const message = messageOf(
        () => (scope.resolve("writeServices") as WriteServices).addComment,
      );

      assert.match(message, /Cannot resolve group "writeServices"\./);
      assert.match(message, /writeServices \(group\)/);
      assert.match(message, /AddComment \(addComment\)/);
    });

    it("should name construction-time member access as the cause and call-time access as the fix", () => {
      const scope = boot(selfReading()).createScope();
      const message = messageOf(
        () => (scope.resolve("writeServices") as WriteServices).addComment,
      );

      assert.match(
        message,
        /A member of group "writeServices" was read during construction\./,
      );
      assert.match(
        message,
        /Reading writeServices\.addComment builds that member/,
      );
      assert.match(message, /Read group members at CALL time/);
      assert.match(message, /the group value is inert/);
    });

    it("should name the innermost hop when the loop runs through a sibling", () => {
      const scope = boot(
        manifest({
          contracts: {
            AddComment: contractRow(
              "buildEagerSiblingComment",
              "addComment",
              "AddComment",
            ),
            ToggleReaction: contractRow(
              "buildEagerSiblingReaction",
              "toggleReaction",
              "ToggleReaction",
            ),
          },
        }),
      ).createScope();

      const message = messageOf(
        () => (scope.resolve("writeServices") as WriteServices).addComment,
      );

      assert.match(message, /cyclic dependency detected/);
      /* `toggleReaction` read `writeServices.addComment` — the read that actually closed the loop. */
      assert.match(
        message,
        /Reading writeServices\.addComment builds that member/,
      );
    });

    it("should leave the container usable — a later resolve is unaffected", () => {
      const container = boot(selfReading());
      const broken = container.createScope();
      messageOf(
        () => (broken.resolve("writeServices") as WriteServices).addComment,
      );

      const healthy = boot().createScope();
      assert.strictEqual(
        (
          healthy.resolve("writeServices") as WriteServices
        ).toggleReaction.react(),
        "reacted",
      );
    });
  });

  describe("When the same group key is resolved from two scopes", () => {
    it("should resolve members per scope, from the cradle captured at group construction", () => {
      const container = boot();
      const first = container.createScope();
      const second = container.createScope();

      const firstGroup = first.resolve("writeServices") as WriteServices;
      const secondGroup = second.resolve("writeServices") as WriteServices;

      assert.strictEqual(
        firstGroup.toggleReaction,
        first.resolve("toggleReaction"),
      );
      assert.strictEqual(
        secondGroup.toggleReaction,
        second.resolve("toggleReaction"),
      );
      assert.notStrictEqual(
        firstGroup.toggleReaction,
        secondGroup.toggleReaction,
      );
      assert.strictEqual(builds.toggleReaction, 2);
    });
  });

  describe("When one group value's member property is read more than once", () => {
    it("should memoize per group instance, as eager building did", () => {
      const scope = boot(
        manifest({
          contracts: {
            AddComment: contractRow(
              "buildAddComment",
              "addComment",
              "AddComment",
            ),
            ToggleReaction: {
              toggleReaction: {
                exportName: "buildToggleReaction",
                registrationKey: "toggleReaction",
                modulePath: "toggleReaction.ts",
                relImport: "../toggleReaction.js",
                contractName: "ToggleReaction",
                implementationName: "toggleReaction",
                /* Transient: without the memo, two reads of one group value would be two objects,
                   which eager building never did. */
                lifetime: "transient" as const,
                moduleIndex: 0,
              },
            },
          },
        }),
      ).createScope();

      const group = scope.resolve("writeServices") as WriteServices;

      assert.strictEqual(group.toggleReaction, group.toggleReaction);
      assert.strictEqual(builds.toggleReaction, 1);

      /* A second group value is a second memo — group roots are transient. */
      const other = scope.resolve("writeServices") as WriteServices;
      assert.notStrictEqual(other.toggleReaction, group.toggleReaction);
    });
  });

  describe("When the group is a collection", () => {
    const collectionModules: readonly IocModuleNamespace[] = [
      {
        buildFileLogger: (): Logger => {
          builds.loggers += 1;
          return { serial: builds.loggers, kind: "file", log: () => "file" };
        },
        buildAuditLogger: (): Logger => {
          builds.loggers += 1;
          return { serial: builds.loggers, kind: "audit", log: () => "audit" };
        },
        /* A collection member that consumes its own group and iterates it at CALL time. */
        buildFanoutLogger: ({
          loggers,
        }: {
          loggers: readonly Logger[];
        }): Logger => {
          builds.loggers += 1;
          return {
            serial: builds.loggers,
            kind: "fanout",
            /* Reads the family at CALL time — including its own slot, which the filter drops by
               kind rather than by calling into it. */
            log: () =>
              loggers
                .filter((entry) => entry.kind !== "fanout")
                .map((entry) => entry.log())
                .join(","),
          };
        },
      },
      {
        /* Reads its own slot out of the collection while it is being built: a real cycle. */
        buildEagerLogger: ({
          loggers,
        }: {
          loggers: readonly Logger[];
        }): Logger => {
          const self = loggers[0];
          return {
            serial: 0,
            kind: "eager",
            log: () => `self:${String(self?.serial)}`,
          };
        },
      },
    ];

    const collectionManifest = (
      members: readonly { contractName: string; registrationKey: string }[],
      contracts: Record<string, unknown>,
    ): IocRegisterableManifest => ({
      manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
      moduleImports: collectionModules,
      contracts: contracts as IocRegisterableManifest["contracts"],
      loggers: {
        kind: "collection" as const,
        baseType: "Logger",
        baseTypeId: "/fake/logger.ts:Logger",
        members: [...members],
      },
    });

    const twoLoggers = (): IocRegisterableManifest =>
      collectionManifest(
        [
          { contractName: "FileLogger", registrationKey: "fileLogger" },
          { contractName: "AuditLogger", registrationKey: "auditLogger" },
        ],
        {
          FileLogger: contractRow(
            "buildFileLogger",
            "fileLogger",
            "FileLogger",
          ),
          AuditLogger: contractRow(
            "buildAuditLogger",
            "auditLogger",
            "AuditLogger",
          ),
        },
      );

    it("should build no members when the group is resolved", () => {
      const scope = boot(twoLoggers()).createScope();

      scope.resolve("loggers");

      assert.strictEqual(builds.loggers, 0);
    });

    it("should stay a real array — isArray, length, indexing, spread", () => {
      const scope = boot(twoLoggers()).createScope();
      const loggers = scope.resolve("loggers") as readonly Logger[];

      assert.ok(Array.isArray(loggers));
      assert.strictEqual(loggers.length, 2);
      assert.strictEqual(loggers[0]!.log(), "file");
      assert.strictEqual(
        builds.loggers,
        1,
        "indexing builds only what it read",
      );
      assert.deepStrictEqual(
        [...loggers].map((entry) => entry.log()),
        ["file", "audit"],
      );
      assert.strictEqual(builds.loggers, 2);
    });

    it("should hand out the same instances the cradle would", () => {
      const scope = boot(twoLoggers()).createScope();
      const loggers = scope.resolve("loggers") as readonly Logger[];

      assert.strictEqual(loggers[0], scope.resolve("fileLogger"));
      assert.strictEqual(loggers[1], scope.resolve("auditLogger"));
    });

    it("should let a member hold its own group and iterate it at call time", () => {
      const scope = boot(
        collectionManifest(
          [
            { contractName: "FileLogger", registrationKey: "fileLogger" },
            { contractName: "AuditLogger", registrationKey: "auditLogger" },
            { contractName: "FanoutLogger", registrationKey: "fanoutLogger" },
          ],
          {
            FileLogger: contractRow(
              "buildFileLogger",
              "fileLogger",
              "FileLogger",
            ),
            AuditLogger: contractRow(
              "buildAuditLogger",
              "auditLogger",
              "AuditLogger",
            ),
            FanoutLogger: contractRow(
              "buildFanoutLogger",
              "fanoutLogger",
              "FanoutLogger",
            ),
          },
        ),
      ).createScope();

      const loggers = scope.resolve("loggers") as readonly Logger[];

      /* Eagerly, building the group built `fanoutLogger`, whose deps name `loggers` — the same
         manufactured cycle the record kind had. Lazily it is just a member reading its family. */
      assert.strictEqual(loggers[2]!.log(), "file,audit");
    });

    it("should shape a collection member's construction-time read the same way", () => {
      const scope = boot(
        collectionManifest(
          [{ contractName: "EagerLogger", registrationKey: "eagerLogger" }],
          {
            EagerLogger: {
              eagerLogger: {
                exportName: "buildEagerLogger",
                registrationKey: "eagerLogger",
                modulePath: "eagerLogger.ts",
                relImport: "../eagerLogger.js",
                contractName: "EagerLogger",
                implementationName: "eagerLogger",
                lifetime: "scoped" as const,
                moduleIndex: 1,
              },
            },
          },
        ),
      ).createScope();

      const message = messageOf(
        () => (scope.resolve("loggers") as readonly Logger[])[0],
      );

      assert.match(message, /cyclic dependency detected/);
      assert.match(
        message,
        /A member of group "loggers" was read during construction\./,
      );
      assert.match(message, /Reading loggers\[0\] builds that member/);
    });
  });
});
