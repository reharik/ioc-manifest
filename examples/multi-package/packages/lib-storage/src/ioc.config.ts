import { defineIocConfig } from "ioc-manifest";

export default defineIocConfig({
  lifetimeMarkers: {
    IScoped: "scoped",
  },
  discovery: {
    scanDirs: ["src/factories"],
    generatedDir: "src/generated",
    includes: ["**/*.{ts,tsx}"],
  },
  registrations: {
    Storage: {
      localStorage: { default: true },
    },
  },
  groups: {
    /**
     * The family. Its base carries the `IScoped` marker, so every member ranks scoped through the
     * group rather than through a declaration of its own (Ruling 2).
     *
     * Grouped ⇒ group-only: `storageEventLogger` and `auditEventLogger` have no cradle keys, and
     * `LoggingService` has no contract key. `loggers` is the whole of the family's exposure.
     */
    loggers: {
      kind: "collection",
      baseType: "LoggingService",
    },
    /**
     * The other kind. A record group keys its members by contract, which is what lets `addComment`
     * reach `toggleReaction` — the only road to a sibling, since neither member has a cradle key.
     * Members resolve when they are READ, so holding the group inside a member is free and
     * `buildAddComment` reads its sibling at call time.
     */
    writeServices: {
      kind: "object",
      baseType: "WriteService",
    },
  },
});
