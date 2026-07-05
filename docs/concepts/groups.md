# Groups

Groups collect implementations whose **contract types declare** `extends` on a shared base type (nominal membership — same rules as lifetime markers). There are two kinds — `collection` and `object` — and they solve different real-world problems. A group with no local members emits `[ioc-warn]` but still generates; members may come from other composed packages.

## Collection groups: the strategy pattern

Say you have a pricing engine with five discount strategies, each implementing the same interface:

```ts
export type DiscountStrategy = {
  applies: (order: Order) => boolean;
  calculate: (order: Order) => number;
};

// buildVolumeDiscount.ts → DiscountStrategy
// buildSeasonalDiscount.ts → DiscountStrategy
// buildLoyaltyDiscount.ts → DiscountStrategy
// buildCouponDiscount.ts → DiscountStrategy
// buildBundleDiscount.ts → DiscountStrategy
```

Without groups, you'd have to manually wire all five into an array. With a collection group:

```ts
groups: {
  discountStrategies: {
    kind: "collection",
    baseType: "DiscountStrategy",
  },
},
```

Now `container.resolve("discountStrategies")` gives you `ReadonlyArray<DiscountStrategy>` — every implementation whose contract type declares `extends DiscountStrategy`, discovered automatically. Your strategy runner just iterates through the array:

```ts
type PricingEngineDeps = {
  discountStrategies: ReadonlyArray<DiscountStrategy>;
};

export const buildPricingEngine = ({
  discountStrategies,
}: PricingEngineDeps): PricingEngine => ({
  applyDiscounts: (order) => {
    for (const strategy of discountStrategies) {
      if (strategy.applies(order)) {
        order.discount += strategy.calculate(order);
      }
    }
    return order;
  },
});
```

Add a sixth strategy? Just create the factory. It shows up in the group automatically — no registration changes.

If you need strategies to run in a specific order, put ordering metadata on the strategy interface itself (e.g. a `priority` field) and sort at use time. The library never tries to order group members.

## Object groups: bundling related services

Object groups are for when you have several services that implement a common base type and you want to access them as a keyed bundle rather than an array. A real example: in a GraphQL API, you might have a set of user-scoped read services that all need to be available on the resolver context:

```ts
export type ReadService = {
  readonly scope: "user";
};

// buildUserReadService.ts → UserReadService (extends ReadService)
// buildOrderReadService.ts → OrderReadService (extends ReadService)
// buildNotificationReadService.ts → NotificationReadService (extends ReadService)
```

```ts
groups: {
  readServices: {
    kind: "object",
    baseType: "ReadService",
  },
},
```

Now `container.resolve("readServices")` returns an object keyed by each contract's convention name — `{ userReadService: UserReadService, orderReadService: OrderReadService, ... }`. You can spread that straight onto your GraphQL context without importing each service individually.

## Group validation

The generator validates that group names don't collide with implementation keys or access keys. Group names are otherwise unconstrained — a collection group can take a contract's plural name (e.g. a `storages` group for the `Storage` contract), which earlier versions reserved for an auto-generated collection. If a base type has no assignable implementations, generation fails with an actionable error. Cross-manifest group composition is covered in [Cross-package composition](/monorepo/composition).

## Consuming a group from the same package

A factory can consume a group declared in its own package. The group's aggregate type — the array for a collection, the keyed object for an object group — is generated, so there's no hand-written type to import.

Alongside `IocGeneratedCradle`, generation emits a **named type alias for each group**, so you can import it directly. The alias is the group's access key in PascalCase — `channels` → `Channels`:

```ts
import type { Channels } from "./generated/ioc-registry.types.js";
import type { NotificationService } from "./channel-contracts.js";

type NotificationServiceDeps = {
  channels: Channels;
};

export const buildNotificationService = ({
  channels,
}: NotificationServiceDeps): NotificationService => ({
  notifyAll: (to) => {
    channels.emailChannel.sendEmail(to);
    channels.smsChannel.sendSms(to);
  },
});
```

The equivalent indexed access is still valid and identical — `channels: IocGeneratedCradle["channels"]` — and remains the fallback in the rare case where a group's PascalCase alias would collide with an imported contract type name (generation skips that one alias and emits an `[ioc-warn]` naming the group; every other group still gets its alias, and the file always compiles).

Either way, the [named-deps-type rule](/guide/quick-start#1-create-factories) still holds: the parameter binds to a named type (`NotificationServiceDeps`), and the group type appears only as a *type reference inside it*. You still cannot bind the parameter directly to the cradle (`({ channels }: IocGeneratedCradle)`).

For an object group, members are keyed by their convention name — `channels.emailChannel`, `channels.smsChannel`, the same registration keys derived from `buildEmailChannel` and `buildSmsChannel`. A collection group indexes to `ReadonlyArray<BaseType>` instead.

A few things work as you'd expect:

- **Aliased imports.** `import { IocGeneratedCradle as Cradle }`, then `Cradle["channels"]`, resolves identically.
- **Cold start.** The reference resolves from your source, not from a previously generated file — so first-run generation, or generation after deleting the generated directory, works. There's no chicken-and-egg dependency on prior output.
- **Typos throw.** Indexing a key that is neither a registration nor a declared group — `IocGeneratedCradle["channel"]` when the group is `channels` — fails generation with a diagnostic naming the offending key, instead of silently resolving to `unknown`.
