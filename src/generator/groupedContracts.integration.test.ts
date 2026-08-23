/**
 * Grouped ⇒ group-only, and the group's lifetime lives on its base.
 *
 * The two rulings are one idea seen twice. A group is a FAMILY: its members are handed out
 * interchangeably, so nothing about a member may be named individually (Ruling 1) and nothing about
 * a member may differ from the family (Ruling 2). Both are enforced at generation, and both vacate
 * questions that used to be asked of grouped contracts rather than answering them differently.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import type { IocConfig } from "../config/iocConfig.js";
import { buildGroupPlan } from "../groups/resolveGroupPlan.js";
import { resolveGroupedContracts } from "../groups/groupedContracts.js";
import { analyzeDemandSupply } from "./analyzeDemandSupply/index.js";
import { contractSlotsForPlans } from "./contractSlotKeys.js";
import { discoverFactories } from "./discoverFactories/discoverFactories.js";
import { buildRegistrationPlan } from "./resolveRegistrationPlan.js";
import { resolveLifetimeMarkerTypes } from "./resolveLifetimeMarkers.js";
import { validateGroupLifetimeAtCodegen } from "./validateGroupLifetimeAtCodegen.js";
import { validateLifetimeInversionsAtCodegen } from "./validateLifetimeInversionsAtCodegen.js";
import { buildManifestArtifactSources } from "./writeManifest.js";
import { contractNameToDefaultRegistrationKey } from "./naming.js";
import type { DemandGroupMembership } from "./analyzeDemandSupply/namedInstanceDemand.js";
import type { IocGroupLeafManifest, IocGroupsManifest } from "../core/manifest.js";
import { parseInterfacePropertyNames } from "../composition/parseRegistryInterface.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const fixtureDir = path.join(__dirname, "test-fixtures", "grouped-contracts");
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

const handlersGroup = {
  groups: {
    domainEventHandlers: {
      kind: "collection",
      baseType: "DomainEventHandler",
    },
  },
} as unknown as IocConfig;

const strategiesGroup = {
  groups: {
    notificationStrategies: {
      kind: "object",
      baseType: "NotificationStrategy",
    },
  },
} as unknown as IocConfig;

const auditGroup = {
  lifetimeMarkers: { IScopedUnit: "scoped" },
  groups: {
    auditChannels: { kind: "collection", baseType: "AuditChannel" },
  },
} as unknown as IocConfig;

const demandGroupMemberships = (
  grouped: ReturnType<typeof resolveGroupedContracts>,
  groupsManifest: IocGroupsManifest | undefined,
): ReadonlyMap<string, DemandGroupMembership> => {
  const out = new Map<string, DemandGroupMembership>();
  for (const [contractName, membership] of grouped.byContractName) {
    const root = groupsManifest?.[membership.groupName];
    const memberProperty =
      root !== undefined && !Array.isArray(root.members)
        ? Object.entries(root.members as Record<string, IocGroupLeafManifest>).find(
            ([, leaf]) => leaf.contractName === contractName,
          )?.[0]
        : undefined;
    out.set(contractName, {
      groupName: membership.groupName,
      kind: membership.kind,
      baseType: membership.baseType,
      groupKey: membership.groupName,
      ...(memberProperty !== undefined ? { memberProperty } : {}),
    });
  }
  return out;
};

/** The real pipeline over a fixture set, in `generateManifest`'s order. */
const generate = (fileNames: readonly string[], config: IocConfig) => {
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

  const groupDiscovery = { program, generatedDir, scanDirs };
  const contracts = acceptedFactories.map((factory) => ({
    contractName: factory.contractName,
    contractTypeRelImport: factory.contractTypeRelImport,
  }));
  const markers =
    config.lifetimeMarkers !== undefined
      ? resolveLifetimeMarkerTypes(program, config.lifetimeMarkers)
      : [];
  const grouped = resolveGroupedContracts(
    config.groups,
    contracts,
    groupDiscovery,
    { markers },
  );

  validateGroupLifetimeAtCodegen({
    contracts,
    grouped,
    config,
    discovery: groupDiscovery,
    projectRoot,
    factories: acceptedFactories,
  });

  const markerLifetimesByFactoryKey = new Map(
    acceptedFactories.flatMap((factory) => {
      const membership = grouped.byContractName.get(factory.contractName);
      const lifetime =
        membership !== undefined
          ? grouped.baseMarkerLifetimeByGroup.get(membership.groupName)
          : undefined;
      return lifetime !== undefined
        ? ([[`${factory.modulePath}:${factory.exportName}`, lifetime]] as const)
        : [];
    }),
  );

  const plans = buildRegistrationPlan(
    contractMap,
    config,
    { projectRoot, scanDirs, markerLifetimesByFactoryKey },
    {
      groupedContractNames: new Set(grouped.byContractName.keys()),
      groupNameByContractName: new Map(
        [...grouped.byContractName].map(([n, m]) => [n, m.groupName]),
      ),
      baseMarkerLifetimeByGroup: grouped.baseMarkerLifetimeByGroup,
    },
  );
  const groupResult = buildGroupPlan(config.groups, plans, groupDiscovery);
  const demandSupply = analyzeDemandSupply(acceptedFactories, {
    program,
    projectRoot,
    scanDirs,
    generatedDir,
    groupsManifest: groupResult?.manifest,
    scopeRoots,
    contractSlots: contractSlotsForPlans(plans),
    groupMemberships: demandGroupMemberships(grouped, groupResult?.manifest),
    absentGroupedSlotKeys: new Map(
      [...grouped.byContractName.keys()].map((name) => [
        contractNameToDefaultRegistrationKey(name),
        name,
      ]),
    ),
  });
  const sources = buildManifestArtifactSources(
    [...acceptedFactories],
    plans,
    groupResult?.manifest,
    manifestOutPath,
    "ioc-manifest",
    {
      demandSupply,
      registryTypesBuildContext: { program, generatedDir, scanDirs, projectRoot },
    },
  );
  return { grouped, plans, groupResult, demandSupply, sources, acceptedFactories, config };
};

/**
 * The cradle's own top-level property names, parsed rather than regexed.
 *
 * A record group's value is itself an object literal whose members are printed at the same indent
 * as the cradle's properties, so a text match for `emailStrategy:` cannot tell "is a cradle key"
 * from "is a property of the group value" — which is precisely the distinction under test.
 */
const cradleKeysOf = (typesSource: string): ReadonlySet<string> =>
  new Set(
    parseInterfacePropertyNames(
      typesSource,
      path.join(generatedDir, "ioc-registry.types.ts"),
      "IocGeneratedCradle",
    ).keys(),
  );

const inversionsOf = (result: ReturnType<typeof generate>): string[] => {
  const warnings: string[] = [];
  const prev = console.warn;
  console.warn = (msg: unknown) => {
    warnings.push(String(msg));
  };
  try {
    validateLifetimeInversionsAtCodegen(
      result.acceptedFactories,
      result.plans,
      result.groupResult?.manifest,
      result.demandSupply,
      result.config,
    );
  } finally {
    console.warn = prev;
  }
  return warnings;
};

describe("grouped contracts are group-only", () => {
  describe("When the field's shape is generated (five implementations of one contract)", () => {
    const FIELD = ["contracts.ts", "handlers.ts", "group-consumer.ts"] as const;

    it("should elect nothing and claim no contract key", () => {
      const { plans, grouped, sources } = generate([...FIELD], handlersGroup);

      assert.equal(grouped.byContractName.has("DomainEventHandler"), true);
      const plan = plans.find((p) => p.contractName === "DomainEventHandler")!;
      // Categorically slotless, and flagged as grouped rather than merely unelected.
      assert.equal(plan.contractDefaultElected, false);
      assert.equal(plan.grouped, true);
      assert.equal(cradleKeysOf(sources.typesSource).has("domainEventHandler"), false);
    });

    it("should claim no individual member keys", () => {
      const { sources } = generate([...FIELD], handlersGroup);
      const keys = cradleKeysOf(sources.typesSource);

      for (const key of [
        "alphaHandler",
        "betaHandler",
        "gammaHandler",
        "deltaHandler",
        "domainEventHandler",
      ]) {
        assert.equal(keys.has(key), false, `${key} must not be a cradle key`);
      }
      // The group root is the whole of the family's exposure, and the consumer is satisfied.
      assert.equal(keys.has("domainEventHandlers"), true);
      assert.equal(keys.has("groupConsumer"), true);
    });

    it("should keep every implementation in the group, including the one on the contract key", () => {
      const { groupResult } = generate([...FIELD], handlersGroup);
      const members = groupResult!.manifest.domainEventHandlers!.members;

      // `domainEventHandler` used to be dropped as a "non-default impl at the contract slot". With
      // no slot there is nothing to duplicate, and dropping a member would be a group that looks
      // complete and is not.
      assert.deepEqual(
        (members as { registrationKey: string }[])
          .map((m) => m.registrationKey)
          .sort(),
        [
          "alphaHandler",
          "betaHandler",
          "deltaHandler",
          "domainEventHandler",
          "gammaHandler",
        ],
      );
    });
  });

  describe("When members are distinct contracts (shape 1)", () => {
    const SHAPE1 = ["contracts.ts", "strategies.ts"] as const;

    it("should leave a single-implementation member slotless", () => {
      const { plans, sources } = generate([...SHAPE1], strategiesGroup);

      // One implementation each: the road that elects a slot outright for any ungrouped contract.
      for (const contractName of ["EmailStrategy", "SmsStrategy"]) {
        const plan = plans.find((p) => p.contractName === contractName)!;
        assert.equal(plan.implementations.length, 1);
        assert.equal(plan.grouped, true);
        assert.equal(plan.contractDefaultElected, false);
      }
      const keys = cradleKeysOf(sources.typesSource);
      assert.equal(keys.has("emailStrategy"), false);
      assert.equal(keys.has("smsStrategy"), false);
      // A record group keeps per-member access — through the group value, which IS a cradle key.
      assert.equal(keys.has("notificationStrategies"), true);
      assert.match(sources.typesSource, /notificationStrategies: \{[^}]*emailStrategy: EmailStrategy;/s);
    });
  });

  describe("When an ungrouped contract sits alongside", () => {
    it("should keep its contract key and its member keys", () => {
      const { sources } = generate(
        ["contracts.ts", "handlers.ts", "group-consumer.ts", "loner.ts"],
        handlersGroup,
      );
      assert.equal(cradleKeysOf(sources.typesSource).has("scopedLoner"), true);
    });
  });
});

describe("Named<T> and bare demands against grouped members", () => {
  const doors = [
    {
      name: "Named<MemberContract>",
      files: ["contracts.ts", "handlers.ts", "bad-named-member-contract.ts"],
      config: handlersGroup,
      key: "alphaHandler",
    },
    {
      name: "Named<GroupBase>",
      files: ["contracts.ts", "strategies.ts", "bad-named-group-base.ts"],
      config: strategiesGroup,
      key: "emailStrategy",
    },
    {
      name: "the bare member key",
      files: ["contracts.ts", "strategies.ts", "bad-bare-member-key.ts"],
      config: strategiesGroup,
      key: "emailStrategy",
    },
  ] as const;

  for (const door of doors) {
    describe(`When a member is demanded through ${door.name}`, () => {
      it("should land on the grouped-member error with the three-beat guidance", () => {
        assert.throws(
          () => generate([...door.files], door.config),
          (error: Error) => {
            assert.match(error.message, /\[grouped-member-demand\]/);
            assert.ok(error.message.includes(JSON.stringify(door.key)));
            // Beat 1: consume through the group.
            assert.match(error.message, /Consume it through the group: /);
            // Beat 2: the kind is the lever.
            assert.match(error.message, /the group's `kind` is the lever/);
            // Beat 3: the deferred design question, by its section name.
            assert.match(
              error.message,
              /Consumer-divergent group consumption — considered, deferred/,
            );
            // And never the texts that would misdirect: the problem is the family, not the
            // contract choice, so neither strict identity nor unknown-key may appear.
            assert.doesNotMatch(error.message, /named-contract-mismatch/);
            assert.doesNotMatch(error.message, /named-unknown-key/);
            assert.doesNotMatch(error.message, /named-marker-required/);
            return true;
          },
        );
      });
    });
  }

  describe("When the demanded member's registration key differs from its contract key", () => {
    /**
     * The local half of the pin the composed suite carries — same fixture shape, same law.
     *
     * `buildSlackNotifier` returns `SlackStrategy`, so the member's registration key is
     * `slackNotifier` while the record group exposes it under its CONTRACT key,
     * `slackStrategy`. `registerGroups` builds the group value from the record's own property keys
     * (`resolveGroupNodeFromCradle`), so the contract key is what a consumer writes; suggesting the
     * registration key would name a property the group value does not have.
     *
     * Every other member in this fixture is implemented by a factory named after its contract, so
     * the two spellings coincide and no assertion over them could tell one from the other.
     */
    it("should suggest the record's property key, not the registration key", () => {
      assert.throws(
        () =>
          generate(
            [
              "contracts.ts",
              "strategies.ts",
              "divergent-strategy.ts",
              "bad-bare-divergent-member.ts",
            ],
            strategiesGroup,
          ),
        (error: Error) => {
          assert.match(error.message, /\[grouped-member-demand\]/);
          assert.match(
            error.message,
            /then `notificationStrategies\.slackStrategy`/,
          );
          assert.doesNotMatch(
            error.message,
            /notificationStrategies\.slackNotifier/,
          );
          assert.doesNotMatch(
            error.message,
            /notificationStrategies\.SlackStrategy/,
          );
          return true;
        },
      );
    });
  });

  describe("When a grouped contract's would-be contract key is demanded", () => {
    it("should be recognized rather than drifting out as an external", () => {
      assert.throws(
        () =>
          generate(
            ["contracts.ts", "strategies.ts", "bad-absent-contract-key.ts"],
            strategiesGroup,
          ),
        (error: Error) => {
          assert.match(error.message, /\[grouped-member-demand\]/);
          assert.match(
            error.message,
            /names the contract key "notificationStrategy" of "NotificationStrategy"/,
          );
          return true;
        },
      );
    });
  });
});

describe("group lifetime is declared on the base", () => {
  const AUDIT = ["contracts.ts", "audit.ts"] as const;

  describe("When the base carries a lifetime marker", () => {
    it("should rank every member with group-base provenance", () => {
      const { plans } = generate([...AUDIT], auditGroup);

      for (const contractName of ["FileAuditChannel", "WireAuditChannel"]) {
        const impl = plans.find((p) => p.contractName === contractName)!
          .implementations[0]!;
        assert.equal(impl.lifetime, "scoped");
        // Not `lifetime-marker`: the declaration is somewhere the member does not control, which
        // is exactly what a reader chasing an unexpected lifetime needs to be told.
        assert.equal(impl.lifetimeSource, "group-base-marker");
      }
    });

    it("should report a singleton consuming the group as an inversion through the hop", () => {
      const result = generate(
        [...AUDIT, "audit-consumer.ts", "group-consumer.ts", "handlers.ts"],
        { ...auditGroup, ...handlersGroup, groups: {
          ...(auditGroup.groups ?? {}),
          ...(handlersGroup.groups ?? {}),
        } } as unknown as IocConfig,
      );

      assert.throws(
        () => inversionsOf(result),
        (error: Error) => {
          assert.match(error.message, /auditConsumer/);
          // Named as a group hop, not as a direct edge: group keys are walk hops, not units.
          assert.match(error.message, /via group 'auditChannels'/);
          return true;
        },
      );
    });

    it("should honour the suppression path on the consuming singleton", () => {
      const config = {
        ...auditGroup,
        groups: {
          ...(auditGroup.groups ?? {}),
          ...(handlersGroup.groups ?? {}),
        },
        registrations: {
          AuditConsumer: { auditConsumer: { allowLifetimeInversion: true } },
        },
      } as unknown as IocConfig;

      const result = generate(
        [...AUDIT, "audit-consumer.ts", "group-consumer.ts", "handlers.ts"],
        config,
      );
      assert.deepEqual(inversionsOf(result), []);
    });
  });

  describe("When a member declares its own lifetime", () => {
    it("should reject a marker on the member contract", () => {
      assert.throws(
        () =>
          generate(
            ["contracts.ts", "strategies.ts", "marked-strategy.ts"],
            { ...strategiesGroup, lifetimeMarkers: { IScopedUnit: "scoped" } } as unknown as IocConfig,
          ),
        (error: Error) => {
          assert.match(error.message, /\[group-lifetime-on-member\]/);
          assert.match(
            error.message,
            /lifetime is a property of the group; declare the marker on the base "NotificationStrategy" \(member "MarkedStrategy" may not carry its own\)/,
          );
          return true;
        },
      );
    });

    it("should reject a per-implementation lifetime override in ioc.config", () => {
      assert.throws(
        () =>
          generate([...AUDIT], {
            ...auditGroup,
            registrations: {
              FileAuditChannel: { fileAuditChannel: { lifetime: "singleton" } },
            },
          } as unknown as IocConfig),
        (error: Error) => {
          assert.match(error.message, /\[group-lifetime-config-override\]/);
          assert.match(
            error.message,
            /declare the marker on the base "AuditChannel" \(member "FileAuditChannel" may not carry its own\)/,
          );
          return true;
        },
      );
    });
  });
});

describe("markers and groups are orthogonal", () => {
  it("should let a contract extending both join the group and rank the lifetime", () => {
    const { grouped, plans } = generate(
      ["contracts.ts", "audit.ts"],
      auditGroup,
    );

    // `FileAuditChannel extends AuditChannel`, and `AuditChannel extends IScopedUnit`.
    assert.equal(grouped.byContractName.has("FileAuditChannel"), true);
    assert.equal(
      plans.find((p) => p.contractName === "FileAuditChannel")!
        .implementations[0]!.lifetime,
      "scoped",
    );
  });

  it("should never let a lifetime marker induce group membership", () => {
    const { grouped, plans, sources } = generate(
      ["contracts.ts", "audit.ts", "loner.ts"],
      auditGroup,
    );

    // `ScopedLoner extends IScopedUnit` and nothing else. Grouping is decided by `config.groups`
    // base types alone, so it joins nothing — and therefore keeps its keys.
    assert.equal(grouped.byContractName.has("ScopedLoner"), false);
    assert.equal(
      plans.find((p) => p.contractName === "ScopedLoner")!.grouped,
      undefined,
    );
    assert.equal(cradleKeysOf(sources.typesSource).has("scopedLoner"), true);
  });
});
