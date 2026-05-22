import { defineIocConfig } from "ioc-manifest";

/** Intentionally broken: typo'd contract name for `ioc validate` demo (not used by generate/typecheck). */
export default defineIocConfig({
  discovery: {
    scanDirs: ["src/factories"],
    generatedDir: "src/generated",
    includes: ["**/*.{ts,tsx}"],
  },
  composedManifests: ["@example/lib-storage", "@example/lib-services"],
  registrations: {
    Storge: {
      s3Storage: { default: true },
    },
    Logger: {
      consoleLogger: { default: true },
    },
    LoggingService: {
      requestTracingLogger: { default: true },
    },
  },
});
