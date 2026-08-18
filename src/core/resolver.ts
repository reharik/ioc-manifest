/**
 * Derives a registration key from an export name when `key` is omitted (legacy / convenience).
 * `buildAlbumService` → `albumService`
 */
export const keyFromExportName = (
  exportName: string,
  factoryPrefix = "build",
): string => {
  if (
    factoryPrefix.length > 0 &&
    exportName.startsWith(factoryPrefix) &&
    exportName.length > factoryPrefix.length
  ) {
    const rest = exportName.slice(factoryPrefix.length);
    return rest.charAt(0).toLowerCase() + rest.slice(1);
  }

  return exportName.charAt(0).toLowerCase() + exportName.slice(1);
};

/**
 * camelCase conversion matching Awilix's own `loadModules({ formatName: "camelCase" })`.
 *
 * Ported (not imported — Awilix does not export it) from `awilix/lib/camel-case`, so a class
 * migrating off `loadModules` keeps its container key. Words split on non-alphanumeric separators
 * and on case transitions (`fooBar` → `foo|Bar`, `HTMLParser` → `HTML|Parser`); the first word is
 * lowercased, later words are capitalized with the rest lowercased, and a later word starting with
 * a digit is prefixed with `_`.
 *
 * `S3MediaStorage` → `s3MediaStorage`; `APIClient` → `apiClient`; `HTTPSProxy` → `httpsProxy`.
 */
export const awilixCamelCase = (input: string): string => {
  const len = input.length;
  if (len === 0) {
    return "";
  }

  let result = "";
  let wordIdx = 0;
  let wordPos = 0;
  let inWord = false;
  /* 0 = separator / start, 1 = uppercase, 2 = lowercase, 3 = digit */
  let prevType = 0;

  for (let i = 0; i < len; i += 1) {
    const c = input.charCodeAt(i);
    const type =
      c >= 97 && c <= 122
        ? 2
        : c >= 65 && c <= 90
          ? 1
          : c >= 48 && c <= 57
            ? 3
            : 0;

    if (type === 0) {
      if (inWord) {
        wordIdx += 1;
        inWord = false;
      }
      prevType = 0;
      continue;
    }

    if (!inWord) {
      inWord = true;
      wordPos = 0;
    } else if (type === 1) {
      const nextIsLower =
        i + 1 < len &&
        input.charCodeAt(i + 1) >= 97 &&
        input.charCodeAt(i + 1) <= 122;
      if (prevType >= 2 || (prevType === 1 && nextIsLower)) {
        wordIdx += 1;
        wordPos = 0;
      }
    }

    if (wordIdx === 0) {
      result += type === 1 ? String.fromCharCode(c | 0x20) : input[i];
    } else if (wordPos === 0) {
      if (type === 3) {
        result += `_${input[i]}`;
      } else {
        result += type === 2 ? String.fromCharCode(c & 0x5f) : input[i];
      }
    } else {
      result += type === 1 ? String.fromCharCode(c | 0x20) : input[i];
    }

    wordPos += 1;
    prevType = type;
  }

  return result;
};

/**
 * Registration key for a class registration unit: camelCase of the class name.
 * `S3MediaStorage` → `s3MediaStorage`. See {@link awilixCamelCase}.
 */
export const keyFromClassName = (className: string): string =>
  awilixCamelCase(className);

export type RegistrationKeyResolutionContext = {
  /** e.g. path relative to project root */
  modulePath: string;
  contractName: string;
  exportName: string;
};

/**
 * Precedence: `ioc.config` `registrations[contract][implementation].name` (passed as `configRegistrationName`)
 * → conventional key from export name.
 * Never returns an empty string; throws with actionable detail if a key cannot be determined.
 */
export const resolveRegistrationKeyForFactory = (
  exportName: string,
  configRegistrationName: string | undefined,
  contractName: string,
  ctx: RegistrationKeyResolutionContext,
  factoryPrefix = "build",
): string => {
  if (configRegistrationName !== undefined && configRegistrationName.length > 0) {
    return configRegistrationName;
  }
  const derived = keyFromExportName(exportName, factoryPrefix);
  if (derived.length === 0) {
    throw new Error(
      `[ioc] Cannot determine Awilix registration key for export ${JSON.stringify(exportName)} (contract ${JSON.stringify(contractName)}) in "${ctx.modulePath}". Set registrations[${JSON.stringify(contractName)}][implementationName].name in ioc.config.ts, or use a factory export name that yields a non-empty key (e.g. buildMyService).`,
    );
  }
  return derived;
};

/**
 * Precedence: `ioc.config` `registrations[contract][implementation].name` → camelCase of the class
 * name. Same policy as {@link resolveRegistrationKeyForFactory}, second unit kind.
 */
export const resolveRegistrationKeyForClass = (
  className: string,
  configRegistrationName: string | undefined,
  contractName: string,
  ctx: RegistrationKeyResolutionContext,
): string => {
  if (configRegistrationName !== undefined && configRegistrationName.length > 0) {
    return configRegistrationName;
  }
  const derived = keyFromClassName(className);
  if (derived.length === 0) {
    throw new Error(
      `[ioc] Cannot determine Awilix registration key for class ${JSON.stringify(className)} (contract ${JSON.stringify(contractName)}) in "${ctx.modulePath}". Set registrations[${JSON.stringify(contractName)}][implementationName].name in ioc.config.ts, or rename the class so camelCase yields a non-empty key.`,
    );
  }
  return derived;
};
