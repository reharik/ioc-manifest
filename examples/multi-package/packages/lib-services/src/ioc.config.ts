import { defineIocConfig } from "ioc-manifest";

export default defineIocConfig({
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
