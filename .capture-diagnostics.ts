/**
 * Phase 1 byte-identity harness (scratch, deleted before commit): render every composition
 * diagnostic this corpus can produce, before and after the plumbing commit, and diff the dumps.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { IocConfig } from "./src/config/iocConfig.js";
import {
  implSource,
  manifestSource,
  parsedSlice,
  typesSource,
  compositionContextFixture,
} from "./src/test-support/manifestFixtures.js";
import { buildCompositionSlice } from "./src/composition/compositionContext.js";
import { runCompositionChecks } from "./src/composition/runCompositionChecks.js";
import {
  buildValidationReport,
  formatValidationReportText,
} from "./src/composition/compositionReport.js";
import type { CompositionContext } from "./src/composition/types.js";

const appConfig = { composedManifests: ["@lib/a"] } as unknown as IocConfig;

const makeRoot = (label: string): string => {
  const root = mkdtempSync(path.join(tmpdir(), `ioc-capture-${label}-`));
  writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: "ES2022",
        module: "ES2022",
      },
    }),
  );
  return root;
};

const LOGGER = "{ log: (msg: string) => void }";

const scenarios: {
  name: string;
  ctx: () => CompositionContext;
  config?: IocConfig;
}[] = [
  {
    name: "unsatisfied external, nothing supplies it",
    ctx: () =>
      compositionContextFixture([
        parsedSlice({
          packageLabel: "@apps/api",
          sourceId: "local",
          cradleKeys: new Set(["appOnly"]),
        }),
        parsedSlice({
          packageLabel: "@lib/a",
          sourceId: "@lib/a",
          cradleKeys: new Set(["svc"]),
          externals: {
            logger: { typeText: "Logger" },
            clock: { typeText: "Clock" },
          },
        }),
      ]),
  },
  {
    name: "external supplied with an incompatible type",
    ctx: () => {
      const root = makeRoot("mismatch");
      const localTypesPath = path.join(root, "local.types.ts");
      const libTypesPath = path.join(root, "lib.types.ts");
      writeFileSync(
        localTypesPath,
        typesSource("logger: { log: (n: number) => void }", ""),
      );
      writeFileSync(libTypesPath, typesSource("", `logger: ${LOGGER}`));
      return {
        ...compositionContextFixture([
          parsedSlice({
            packageLabel: "@apps/api",
            sourceId: "local",
            typesPath: localTypesPath,
            cradleKeys: new Set(["logger"]),
            cradleTypes: {
              logger: { typeText: "{ log: (n: number) => void }" },
            },
          }),
          parsedSlice({
            packageLabel: "@lib/a",
            sourceId: "@lib/a",
            typesPath: libTypesPath,
            externals: { logger: { typeText: LOGGER } },
          }),
        ]),
        projectRoot: root,
      };
    },
  },
  {
    name: "registry-integrity: local generated types do not compile",
    ctx: () => {
      const root = makeRoot("integrity");
      const localTypesPath = path.join(root, "local.types.ts");
      const libTypesPath = path.join(root, "lib.types.ts");
      writeFileSync(
        localTypesPath,
        "export interface IocGeneratedCradle { logger: MissingLogger; }\nexport interface IocExternals {}",
      );
      writeFileSync(
        libTypesPath,
        typesSource("", `logger: ${LOGGER}\n  clock: { now: () => number }`),
      );
      return {
        ...compositionContextFixture([
          parsedSlice({
            packageLabel: "@apps/api",
            sourceId: "local",
            typesPath: localTypesPath,
            cradleKeys: new Set(["logger"]),
            cradleTypes: { logger: { typeText: LOGGER } },
          }),
          parsedSlice({
            packageLabel: "@lib/a",
            sourceId: "@lib/a",
            typesPath: libTypesPath,
            externals: {
              logger: { typeText: LOGGER },
              clock: { typeText: "{ now: () => number }" },
            },
          }),
        ]),
        projectRoot: root,
      };
    },
  },
  {
    name: "same-key conflict and default ambiguity across slices",
    ctx: () => {
      const root = makeRoot("conflict");
      const localTypes = path.join(root, "local.types.ts");
      const libTypes = path.join(root, "lib.types.ts");
      writeFileSync(localTypes, typesSource("mailer: Mailer", ""));
      writeFileSync(libTypes, typesSource("mailer: Mailer", ""));
      const local = buildCompositionSlice(
        "@apps/api",
        "local",
        path.join(root, "local.manifest.ts"),
        manifestSource(`Mailer: { smtp: ${implSource("mailer")} }`),
        localTypes,
        typesSource("mailer: Mailer", ""),
      );
      const lib = buildCompositionSlice(
        "@lib/a",
        "@lib/a",
        path.join(root, "lib.manifest.ts"),
        manifestSource(
          `Mailer: { ses: ${implSource("mailer")}, sendgrid: ${implSource("mailer2")} }`,
        ),
        libTypes,
        typesSource("mailer: Mailer", ""),
      );
      return { ...compositionContextFixture([local, lib]), projectRoot: root };
    },
  },
  {
    name: "app-config sanity: override names an unknown contract",
    ctx: () =>
      compositionContextFixture([
        parsedSlice({ packageLabel: "@apps/api", sourceId: "local" }),
        parsedSlice({ packageLabel: "@lib/a", sourceId: "@lib/a" }),
      ]),
    config: {
      composedManifests: ["@lib/a"],
      registrations: { NotAContract: { impl: { default: true } } },
    } as unknown as IocConfig,
  },
];

const out: string[] = [];
for (const scenario of scenarios) {
  out.push(`#### ${scenario.name}`);
  const issues = runCompositionChecks(
    scenario.config ?? appConfig,
    scenario.ctx(),
  );
  out.push(formatValidationReportText(buildValidationReport(issues)));
  out.push("");
}
process.stdout.write(
  out.join("\n").replace(/\/tmp\/ioc-capture-[a-z]+-[A-Za-z0-9]+/g, "<ROOT>"),
);
