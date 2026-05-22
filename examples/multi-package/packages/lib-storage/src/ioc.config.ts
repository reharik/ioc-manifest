import { defineIocConfig } from "ioc-manifest";

export default defineIocConfig({
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
    loggers: {
      kind: "collection",
      baseType: "LoggingService",
    },
  },
});
