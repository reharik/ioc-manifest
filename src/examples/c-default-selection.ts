/**
 * Lesson c — the contract key, the implementation key, and how to demand each.
 *
 * A contract with an elected default answers to two kinds of name, and they mean different things:
 *
 * - the **contract key** (`widget`, the camel-cased contract name) resolves whichever implementation
 *   is elected as the default, so it keeps meaning "the Widget this app uses" when `ioc.config`
 *   moves the election;
 * - an **implementation key** (`secondaryWidget`, from the factory export name) resolves that one
 *   implementation and nothing else.
 *
 * At a deps site the first is written plainly and the second carries `Named<T>`. Both spellings
 * appear side by side in `buildWidgetInspector` at the bottom of this file. The marker is required,
 * not advisory: a bare `secondaryWidget: Widget` is a hard error, because without it the property is
 * indistinguishable from a contract-key demand and from an external.
 *
 * The two names stay distinct only if no implementation is NAMED after its contract while some
 * other implementation is elected — see `buildAuditedMediaStorage` below for why, and for the two
 * ways out when it happens.
 */
import type { Named } from "../named/named.js";
import type { MediaStorage } from "./b-multiple-implementations.js";

export type Widget = { id: string };

/**
 * Scenario C1: a third `MediaStorage`, deliberately NOT named after its contract.
 *
 * Calling this `buildMediaStorage` would register it under `mediaStorage` — which is
 * `MediaStorage`'s SLOT key, the name that means "whichever implementation is elected". Awilix
 * holds one registration per name, so that factory would OWN the key: `mediaStorage` would hand out
 * this implementation while `ioc.config` elects `s3MediaStorage`, and the slot would quietly stop
 * following the election. Every consumer writing the contract key — `buildAlbumService` in lesson
 * f, `ArchiveMediaStorage` in lesson g — would get the wrong one and have no way to see it.
 *
 * A registration occupying its contract's slot key must therefore BE the electee. Anything else is
 * a hard error, at `ioc generate` and in `ioc validate` alike, and the error names both exits:
 * rename the factory so its key stops shadowing the slot, or elect the occupant. The rename is
 * taken here — `s3MediaStorage` keeps the election, `mediaStorage` keeps its meaning, and this
 * implementation is reachable as `auditedMediaStorage` with `Named<MediaStorage>`.
 *
 * The occupant IS allowed to be the electee: a contract with exactly one implementation, named
 * after it, is the sanctioned single-name case — the slot and the key coincide by agreement.
 */
export const buildAuditedMediaStorage = (): MediaStorage => {
  return {
    label: "audited",
    put: async () => {
      /* noop */
    },
  };
};

/**
 * Scenario C2 helpers: two competing implementations (used from runExample with explicit `default` + overrides).
 * Keys are unique for the playground manifest.
 */
export const buildPrimaryWidget = (): Widget => ({
  id: "primary",
});

export const buildSecondaryWidget = (): Widget => ({
  id: "secondary",
});

/** What the two-spellings consumer below produces. */
export type WidgetInspector = {
  describe: () => string;
};

type WidgetInspectorDeps = {
  /**
   * The CONTRACT key. `ioc.config` elects `primaryWidget`, so this resolves to it today — and would
   * follow the election to `secondaryWidget` the moment the config changed, with no edit here.
   */
  widget: Widget;
  /**
   * The IMPLEMENTATION key, declared as one. `Named<Widget>` says "the registration named
   * `secondaryWidget`, whose contract is `Widget`" and is checked against that implementation's own
   * declared contract exactly — a supertype would not do. This binding does not follow the election.
   */
  secondaryWidget: Named<Widget>;
};

/** The lesson in one unit: the elected default and one specific implementation, together. */
export const buildWidgetInspector = ({
  widget,
  secondaryWidget,
}: WidgetInspectorDeps): WidgetInspector => ({
  describe: () =>
    `default widget is ${widget.id}; the pinned one is ${secondaryWidget.id}`,
});
