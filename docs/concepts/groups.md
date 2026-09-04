# Groups

Groups collect implementations whose **contract types declare heritage** to a shared base type (nominal membership — same rules as lifetime markers). Heritage means `extends`, an intersection (`type Foo = Bar & Base`), or a plain alias (`type Foo = Base`) — never structural similarity. There are two kinds — `collection` and `object` — and they solve different real-world problems. A group with no local members emits `[ioc-warn]` but still generates; members may come from other composed packages.

Both [unit kinds](/concepts/conventions#the-two-registration-units) participate: a class whose `implements` contract declares heritage to the base joins alongside factory members, with no distinction downstream.

## Grouped means group-only

**A contract that joins a group is consumed through the group and through nothing else.** Grouping it is a statement that its implementations are interchangeable members of one family, and the tool holds you to it:

- the contract has **no contract key** — not "unelected", categorically none, even with a single implementation;
- its implementations have **no individual cradle keys** — a record group exposes every member as a property of the group value, and a collection group's members are anonymous by declaration;
- nothing elects a default for it, so several implementations with no `default: true` is the ordinary shape rather than an ambiguity error.

Demanding a member individually is a hard error, whichever way you spell it:

```ts
// All four are the same mistake, and all four get the same guidance.
type Deps = { emailChannel: Named<EmailChannel> };        // the member's contract
type Deps = { emailChannel: Named<NotificationChannel> }; // the family interface
type Deps = { emailChannel: EmailChannel };               // bare
type Deps = { notificationChannel: NotificationChannel }; // the contract key it doesn't have

// This is how you reach it:
type Deps = { notificationChannels: NotificationChannels };
//   …then notificationChannels.emailChannel, for a record group.
```

Runtime still registers member keys — the group resolver needs them to hand its members out — so what changes is what you may **name**, not what the container holds.

If you genuinely need the family for one consumer and one member for another, that is a real and deliberately deferred design question: see [Consumer-divergent group consumption](/design/per-package-manifest#_8-7-consumer-divergent-group-consumption-considered-deferred). Until it is answered, your options are to filter at use time, to use `kind: "object"` so members are exposed as properties, or to take the member out of the group.

## Lifetime belongs to the group

A family whose members disagree about lifetime is not a family: resolving the group would hand back a mixed array and the consumer cannot tell which is which. So the lifetime is declared **once, on the base**:

```ts
export interface LoggingService extends IScoped {
  readonly id: string;
  ping: () => string;
}
```

Every member ranks it, and `ioc inspect --discovery` reports the provenance as `scoped (group-base-marker)` so an unexpected lifetime is traceable to the declaration you did not write locally. Lifetime-inversion checks see it through the group hop: a singleton consuming a scoped group is reported the same as one consuming a scoped member.

That hop is checked at generation and nowhere else. Group member slots are [lazy](#members-resolve-when-you-read-them), so the read usually happens at call time with no enclosing resolution on the stack — Awilix has nothing to rank the member against, and the group root's leak-safe registration is a statement about the root (which holds nothing) rather than a verdict on the members behind it. Turning Awilix strict mode on does not add a second net here, and turning it off does not remove this one.

Members arriving from a [composed package](/monorepo/composition#groups-across-manifests) are ranked too: a composed root merges with the local one and the union is what gets ranked, with each member's lifetime falling back to the composed unit that registers it. A member the run cannot resolve a lifetime for is reported as `UNRANKED, not cleared` rather than quietly skipped — see [Across a composed boundary](/concepts/lifetimes#across-a-composed-boundary).

A member declaring its own lifetime — a marker on its own contract that the base lacks, or a per-implementation `lifetime` in `ioc.config` — is a hard error. It is not outranked by precedence; it is a claim of authority over a property of the family the member does not own.

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

Now `container.resolve("readServices")` returns an object keyed by each contract's convention name — `{ userReadService: UserReadService, orderReadService: OrderReadService, ... }`. You can put that straight onto your GraphQL context without importing each service individually — hold the object rather than spreading it, for the reason [below](#members-resolve-when-you-read-them).

## Members resolve when you read them

Resolving a group resolves **no members**. The value you get back — the keyed object for a record group, the array for a collection — exists immediately, and each member slot resolves from the container the first time it is read, then stays that instance for the life of that group value.

This is what makes the one sanctioned road to a sibling passable. Grouped ⇒ group-only, so a member that needs a sibling must name the group; if resolving the group built every member, then a member naming the group would be naming something that was mid-construction *because of that member*, and the container would report a cycle in a graph that has none. Lazy slots remove the manufactured half: the group is inert, and the sibling resolves at the moment it is read.

So the rule for a member consuming a sibling is about **when you read**, not how you ask:

```ts
type AddCommentDeps = { writeServices: WriteServices };

export const buildAddComment = ({
  writeServices,
}: AddCommentDeps): AddComment => ({
  // Read at CALL time. `toggleReaction` resolves here, when the method runs.
  add: (body) => writeServices.toggleReaction.react(body),
});
```

Destructuring the group in the signature is fine — that is just taking the inert object. What is not fine is reading a **member property** at the top level of the factory body:

```ts
export const buildAddComment = ({ writeServices }: AddCommentDeps): AddComment => {
  const toggle = writeServices.toggleReaction; // ✖ resolves now, mid-construction
  return { add: (body) => toggle.react(body) };
};
```

If that member's construction leads back to the one under construction, it is a genuine cycle and it is reported as one, with the group hop named:

```
[ioc] Cannot resolve group "writeServices".

Resolution chain:
  writeServices (group)
    -> AddComment (addComment) [addComment.ts]
      -> writeServices (group)
        -> AddComment (addComment) [addComment.ts] ✖ cyclic dependency detected

A member of group "writeServices" was read during construction.
```

::: warning Hold the group; don't spread it
Member slots are getters, so anything that enumerates *and reads* the value resolves every member at once: `{ ...writeServices }`, `Object.values(writeServices)`, `structuredClone`, `JSON.stringify`, and iterating or spreading a collection group's array. That is legal — it is only the eager behaviour, on demand — but it is not what you want inside a member, and it undoes the laziness you were relying on. Hold the group and read the members you need.

Logging is safe as-is: `console.log` and `util.inspect` render an unread slot as `[Getter]` rather than invoking it, so printing a group value does not detonate resolution.
:::

## Generic base types

A base type can be generic. When it is, the group declares the type argument with `baseTypeArg`, and every member's bound argument is checked against it at generation.

Say each notification strategy is typed to one template:

```ts
export interface FastSweepNotificationStrategy<T extends TemplateName> {
  kind: T;
  execute: (rows: PendingNotification[]) => Promise<PayloadResult<T>[]>;
}

// buildShareInviteStrategy.ts    → FastSweepNotificationStrategy<'shareInvite'>
// buildWelcomeStrategy.ts        → FastSweepNotificationStrategy<'welcome'>
// buildPasswordResetStrategy.ts  → FastSweepNotificationStrategy<'passwordReset'>
```

The group declares the **bound** — the constraint — so it holds every template:

```ts
groups: {
  fastSweepNotificationStrategies: {
    kind: "collection",
    baseType: "FastSweepNotificationStrategy",
    baseTypeArg: "TemplateName",
  },
},
```

Generation verifies each member's argument is assignable to the declared one (`'shareInvite' extends TemplateName`, etc.) and emits the bounded collection:

```ts
fastSweepNotificationStrategies: ReadonlyArray<
  FastSweepNotificationStrategy<TemplateName>
>;
```

Declare the **constraint** (`TemplateName`) for a bounded-heterogeneous group — members each narrow it. Declare a **literal** (`'welcome'`) for a homogeneous group — only `<'welcome'>` members pass; any other argument fails generation, naming the group, the member, and both arguments.

`baseTypeArg` resolves as source text, so its type must be in scope in the generated file — a named type gets imported automatically. A required-parameter base used with no `baseTypeArg` fails generation rather than emitting a bare, uncompilable reference.

## Group-only base types

A base type often exists *only* to define membership — you inject the group and each member by its own key, but never the base type by itself. Such a base needs no default: declare the group and stop.

```ts
export interface PublicReadServiceBase {
  readonly scope: "public";
}

// buildPublicAlbumReadService.ts      → PublicAlbumReadService (extends PublicReadServiceBase)
// buildPublicMediaItemReadService.ts  → PublicMediaItemReadService (extends PublicReadServiceBase)
```

```ts
groups: {
  publicReadServices: {
    kind: "object",
    baseType: "PublicReadServiceBase",
  },
},
```

Generation emits the group and each member's own key — but no `publicReadServiceBase` key, because nothing injects the base directly:

```ts
publicReadServices: {
  publicAlbumReadService: PublicAlbumReadService;
  publicMediaItemReadService: PublicMediaItemReadService;
};
```

This holds for both generic and non-generic bases — it keys on "group base with no elected default," not on whether the type is generic. If you *do* want the base injectable on its own, elect a default implementation (`default: true`) and its singular key is emitted as usual.

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

::: warning The alias is already the collection type
`Channels` *is* `ReadonlyArray<Channel>`, so the demand is `channels: Channels`. Wrapping it — `ReadonlyArray<Channels>` — asks for an array of arrays; it was never correct, and it is now rejected rather than silently resolved out of the previous generated file. See [Consuming generated types](/reference/generated-types).
:::

Either way, the [named-deps-type rule](/guide/quick-start#1-create-factories) still holds: the parameter binds to a named type (`NotificationServiceDeps`), and the group type appears only as a *type reference inside it*. You still cannot bind the parameter directly to the cradle (`({ channels }: IocGeneratedCradle)`).

For an object group, members are keyed by their convention name — `channels.emailChannel`, `channels.smsChannel`, the same registration keys derived from `buildEmailChannel` and `buildSmsChannel`. A collection group indexes to `ReadonlyArray<BaseType>` instead.

A few things work as you'd expect:

- **Aliased imports.** `import { IocGeneratedCradle as Cradle }`, then `Cradle["channels"]`, resolves identically.
- **Cold start.** The reference resolves from your source, not from a previously generated file — so first-run generation, or generation after deleting the generated directory, works. There's no chicken-and-egg dependency on prior output.
- **Typos throw.** Indexing a key that is neither a registration nor a declared group — `IocGeneratedCradle["channel"]` when the group is `channels` — fails generation with a diagnostic naming the offending key, instead of silently resolving to `unknown`.
