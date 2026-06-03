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
  groups: {
    loggers: {
      kind: "collection",
      baseType: "LoggingService",
    },
  },
});
