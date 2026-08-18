/**
 * @fileoverview Migration warning for class registration units whose filename would have produced
 * a different container key under Awilix's `loadModules`.
 *
 * `loadModules({ formatName: "camelCase" })` keys a module on its FILE NAME; ioc-manifest keys a
 * class unit on its CLASS NAME. In the one-class-per-file codebases the class trigger targets the
 * two agree, and the migration is key-for-key silent. When they disagree the key changes, and the
 * only place a user would otherwise notice is a failed resolve at runtime — so generation says it.
 *
 * The comparison is between the two *keys*, not the two names: a `s3-media-storage.ts` exporting
 * `S3MediaStorage` camelCases to the same key from either side and is not a change worth warning
 * about, while `storage.ts` exporting `S3MediaStorage` is.
 */
import path from "node:path";
import { getClassConfig, type IocConfig } from "../config/iocConfig.js";
import { keyFromClassName } from "../core/resolver.js";
import type { DiscoveredFactory } from "./types.js";

type DivergentClassFileName = {
  modulePath: string;
  className: string;
  awilixKey: string;
  registrationKey: string;
};

const fileStemOf = (modulePath: string): string =>
  path.posix.basename(modulePath.replace(/\\/g, "/")).replace(/\.[^.]+$/, "");

const formatWarning = (entries: readonly DivergentClassFileName[]): string =>
  [
    `[ioc] ${entries.length} class registration(s) key differently than Awilix \`loadModules\` would:`,
    ...entries.map(
      (e) =>
        `  - ${e.modulePath} class "${e.className}": loadModules would register this as ${JSON.stringify(e.awilixKey)} (from the file name); ioc-manifest registers it as ${JSON.stringify(e.registrationKey)} (from the class name).`,
    ),
    "Rename the file to match the class, set registrations[Contract][implementation].name to pin the old key, or declare the change intentional with classes[Class].allowDivergentFileName: true in ioc.config.",
  ].join("\n");

/**
 * Warns (never throws) once, as a single block, for every discovered class unit whose file-name
 * derived key differs from its actual registration key. Suppressed per class via
 * `classes[Class].allowDivergentFileName: true`.
 */
export const warnDivergentClassFileNames = (
  units: readonly DiscoveredFactory[],
  config: IocConfig | undefined,
): void => {
  const entries: DivergentClassFileName[] = [];

  for (const unit of units) {
    if (unit.unitKind !== "class") {
      continue;
    }
    if (getClassConfig(config, unit.exportName)?.allowDivergentFileName === true) {
      continue;
    }

    const awilixKey = keyFromClassName(fileStemOf(unit.modulePath));
    if (awilixKey === unit.registrationKey) {
      continue;
    }

    entries.push({
      modulePath: unit.modulePath,
      className: unit.exportName,
      awilixKey,
      registrationKey: unit.registrationKey,
    });
  }

  if (entries.length === 0) {
    return;
  }

  console.warn(formatWarning(entries));
};
