/**
 * @fileoverview The single validation artifact for `ioc.config`: a zod schema with `.strict()` at
 * every object level, so unknown keys are rejected BY CONSTRUCTION — a config key can no longer be
 * silently ignored (or wrongly rejected) by omission from a hand-maintained whitelist, the failure
 * mode behind the `baseTypeArg` (2.2.1), `allowLifetimeInversion` (2.3.6), and `allowEmpty` bugs.
 * Shape checks live on the same schema nodes as the key sets, and the issue formatters below render
 * the same `[ioc-config] <label> <key path> <expected shape>` messages the previous hand validators
 * produced.
 *
 * Cross-field rules that need no I/O (app/library-mode exclusivity, `source` membership, duplicate
 * detection) run in the schema's refinements. Checks that read the filesystem (self-composition via
 * `package.json`) remain in `loadIocConfig`.
 */
import { z } from "zod";

/** Reserved key under `registrations[ContractName]` for contract-level metadata (not an implementation). */
export const IOC_CONTRACT_CONFIG_KEY = "$contract" as const;

const nonEmptyString = (message: string) =>
  z.string({ error: message }).min(1, { error: message });

const lifetime = (message: string) =>
  z.enum(["singleton", "scoped", "transient"], { error: message });

/** Issue params marking a message as complete after the source label (no key-path prefix). */
const STANDALONE = { standalone: true } as const;

const isStandaloneIssue = (issue: z.core.$ZodIssue): boolean =>
  issue.code === "custom" &&
  (issue.params as { standalone?: boolean } | undefined)?.standalone === true;

// ---------------------------------------------------------------------------------------------
// discovery.scanDirs
// ---------------------------------------------------------------------------------------------

const REMOVED_SCAN_DIR_KEYS: Record<string, string> = {
  importPrefix:
    "discovery.scanDirs[].importPrefix was removed in v2; use composedManifests instead.",
  importMode:
    "discovery.scanDirs[].importMode was removed in v2; use composedManifests instead.",
};

const scanDirSpecSchema = z
  .object({
    path: nonEmptyString("must be a non-empty string"),
    scope: lifetime("must be singleton | scoped | transient when set").optional(),
  })
  .strict();

type RelativeIssue = {
  path: (string | number)[];
  message: string;
  standalone?: boolean;
};

/**
 * Issues for an authored `discovery.scanDirs` value, with paths relative to the value itself.
 * Shared by the config schema (via `ctx.addIssue`, which prefixes `discovery.scanDirs`) and by
 * {@link import("./parseDiscoveryScanDirs.js").parseDiscoveryScanDirs} for standalone use.
 */
export const collectDiscoveryScanDirsIssues = (raw: unknown): RelativeIssue[] => {
  if (typeof raw === "string") {
    return raw.length === 0
      ? [{ path: [], message: "must be a non-empty string when a string is used" }]
      : [];
  }

  if (!Array.isArray(raw) || raw.length === 0) {
    return [
      { path: [], message: "must be a non-empty string, string[], or object[]" },
    ];
  }

  const issues: RelativeIssue[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const el: unknown = raw[i];
    if (typeof el === "string") {
      if (el.length === 0) {
        issues.push({ path: [i], message: "must be a non-empty string" });
      }
      continue;
    }
    if (typeof el !== "object" || el === null || Array.isArray(el)) {
      issues.push({ path: [i], message: "must be a string or an object with path" });
      continue;
    }

    const removedKey = Object.keys(el).find(
      (k) => REMOVED_SCAN_DIR_KEYS[k] !== undefined,
    );
    if (removedKey !== undefined) {
      issues.push({
        path: [],
        message: REMOVED_SCAN_DIR_KEYS[removedKey],
        standalone: true,
      });
      continue;
    }

    const parsed = scanDirSpecSchema.safeParse(el);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        if (issue.code === "unrecognized_keys") {
          for (const key of issue.keys) {
            issues.push({
              path: [i],
              message: `has unknown property ${JSON.stringify(key)}`,
            });
          }
          continue;
        }
        issues.push({ path: [i, ...(issue.path as (string | number)[])], message: issue.message });
      }
    }
  }
  return issues;
};

const scanDirsSchema = z.unknown().superRefine((raw, ctx) => {
  for (const issue of collectDiscoveryScanDirsIssues(raw)) {
    ctx.addIssue({
      code: "custom",
      message: issue.message,
      path: issue.path,
      ...(issue.standalone === true ? { params: STANDALONE } : {}),
    });
  }
});

// ---------------------------------------------------------------------------------------------
// discovery
// ---------------------------------------------------------------------------------------------

const stringArray = () =>
  z.array(z.string({ error: "must be a string" }), {
    error: `must be string[] when set`,
  });

const discoverySchema = z
  .object(
    {
      scanDirs: scanDirsSchema,
      includes: stringArray().optional(),
      excludes: stringArray().optional(),
      factoryPrefix: nonEmptyString("must be a non-empty string when set").optional(),
      generatedDir: nonEmptyString("must be a non-empty string when set").optional(),
    },
    { error: "is missing discovery" },
  )
  .strict();

// ---------------------------------------------------------------------------------------------
// registrations
// ---------------------------------------------------------------------------------------------

const implOverrideSchema = z
  .object({
    name: nonEmptyString("must be a non-empty string when set").optional(),
    lifetime: lifetime("must be singleton | scoped | transient when set").optional(),
    default: z.boolean({ error: "must be a boolean when set" }).optional(),
    source: nonEmptyString("must be a non-empty string when set").optional(),
    allowLifetimeInversion: z
      .union([z.boolean(), z.array(nonEmptyString("must be a non-empty string"))], {
        error: "must be a boolean or a non-empty string[] when set",
      })
      .optional(),
  })
  .strict();

export const contractMetadataSchema = z
  .object({
    accessKey: nonEmptyString("must be a non-empty string when set")
      .refine((key) => key !== IOC_CONTRACT_CONFIG_KEY, {
        error: `cannot be ${JSON.stringify(IOC_CONTRACT_CONFIG_KEY)} (reserved)`,
      })
      .optional(),
    allowDivergentName: z.boolean({ error: "must be a boolean when set" }).optional(),
  })
  .strict();

const CONTRACT_METADATA_UNKNOWN_KEY_SUFFIX =
  " (only accessKey and allowDivergentName are allowed)";

const registrationsSchema = z
  .record(
    z.string(),
    z.record(z.string(), z.unknown(), { error: "must be an object" }),
    { error: "must be an object" },
  )
  .superRefine((registrations, ctx) => {
    for (const [contractName, perImplementation] of Object.entries(registrations)) {
      for (const [implementationName, override] of Object.entries(perImplementation)) {
        const entryPath = [contractName, implementationName];
        if (
          typeof override !== "object" ||
          override === null ||
          Array.isArray(override)
        ) {
          ctx.addIssue({ code: "custom", message: "must be an object", path: entryPath });
          continue;
        }

        const entrySchema =
          implementationName === IOC_CONTRACT_CONFIG_KEY
            ? contractMetadataSchema
            : implOverrideSchema;
        const parsed = entrySchema.safeParse(override);
        if (parsed.success) {
          continue;
        }
        for (const issue of parsed.error.issues) {
          if (issue.code === "unrecognized_keys") {
            const suffix =
              implementationName === IOC_CONTRACT_CONFIG_KEY
                ? CONTRACT_METADATA_UNKNOWN_KEY_SUFFIX
                : "";
            for (const key of issue.keys) {
              ctx.addIssue({
                code: "custom",
                message: `has unknown property ${JSON.stringify(key)}${suffix}`,
                path: entryPath,
              });
            }
            continue;
          }
          ctx.addIssue({
            code: "custom",
            message: issue.message,
            path: [...entryPath, ...(issue.path as (string | number)[])],
          });
        }
      }
    }
  });

// ---------------------------------------------------------------------------------------------
// classes
// ---------------------------------------------------------------------------------------------

export const CLASS_ENTRY_ALLOWED_KEYS = [
  "contract",
  "allowDivergentFileName",
] as const;

const classEntrySchema = z
  .object({
    contract: nonEmptyString("must be a non-empty string when set").optional(),
    allowDivergentFileName: z
      .boolean({ error: "must be a boolean when set" })
      .optional(),
  })
  .strict();

const classesSchema = z.record(z.string(), classEntrySchema, {
  error: "must be an object when set",
});

// ---------------------------------------------------------------------------------------------
// groups / groupBaseTypeAliases / lifetimeMarkers / scopeProvided / composedManifests
// ---------------------------------------------------------------------------------------------

export const GROUP_ENTRY_ALLOWED_KEYS = [
  "kind",
  "baseType",
  "baseTypeArg",
  "allowEmpty",
] as const;

const groupEntrySchema = z
  .object({
    kind: z.enum(["collection", "object"], {
      error: `must be "collection" or "object"`,
    }),
    baseType: nonEmptyString("must be a non-empty string"),
    baseTypeArg: nonEmptyString("must be a non-empty string when set").optional(),
    allowEmpty: z.boolean({ error: "must be a boolean when set" }).optional(),
  })
  .strict();

const groupsSchema = z.record(z.string(), groupEntrySchema, {
  error: "must be an object",
});

const groupBaseTypeAliasesSchema = z.record(
  z.string(),
  z
    .array(nonEmptyString("must be a non-empty string"), {
      error: "must be a string array",
    })
    .min(2, { error: "must contain at least 2 canonical identifier strings" }),
  { error: "must be an object when set" },
);

const lifetimeMarkersSchema = z.record(
  z.string({ error: "keys must be non-empty strings" }).min(1, {
    error: "keys must be non-empty strings",
  }),
  lifetime("must be singleton | scoped | transient"),
  { error: "must be an object when set" },
);

const scopeProvidedSchema = z
  .array(nonEmptyString("must be a non-empty string"), {
    error: "must be an array when set",
  })
  .superRefine((keys, ctx) => {
    const seen = new Set<string>();
    for (const key of keys) {
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: `contains duplicate entry ${JSON.stringify(key)}`,
          path: [],
        });
      }
      seen.add(key);
    }
  });

const composedManifestsSchema = z
  .array(z.string({ error: "must be a string" }), {
    error: "must be string[] when set",
  })
  .superRefine((packages, ctx) => {
    const seen = new Set<string>();
    for (const pkg of packages) {
      if (seen.has(pkg)) {
        ctx.addIssue({
          code: "custom",
          message: `contains duplicate entry ${JSON.stringify(pkg)}`,
          path: [],
        });
      }
      seen.add(pkg);
    }
  });

// ---------------------------------------------------------------------------------------------
// top level
// ---------------------------------------------------------------------------------------------

export const iocConfigSchema = z
  .object({
    discovery: discoverySchema,
    composedManifests: composedManifestsSchema.optional(),
    manifestExportPath: nonEmptyString("must be a non-empty string when set").optional(),
    packageName: nonEmptyString("must be a non-empty string when set").optional(),
    registrations: registrationsSchema.optional(),
    classes: classesSchema.optional(),
    groups: groupsSchema.optional(),
    groupBaseTypeAliases: groupBaseTypeAliasesSchema.optional(),
    lifetimeMarkers: lifetimeMarkersSchema.optional(),
    scopeProvided: scopeProvidedSchema.optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    const composedManifests = config.composedManifests as string[] | undefined;
    const inAppMode = composedManifests !== undefined && composedManifests.length > 0;
    const composedSet = new Set(composedManifests ?? []);

    if (inAppMode && config.manifestExportPath !== undefined) {
      ctx.addIssue({
        code: "custom",
        message:
          "is only valid in library mode; remove it or remove composedManifests for app mode",
        path: ["manifestExportPath"],
      });
    }

    if (config.groupBaseTypeAliases !== undefined && !inAppMode) {
      ctx.addIssue({
        code: "custom",
        message: "is only valid in app mode (when composedManifests is set)",
        path: ["groupBaseTypeAliases"],
      });
    }

    if (config.registrations !== undefined) {
      for (const [contractName, perImplementation] of Object.entries(
        config.registrations,
      )) {
        for (const [implementationName, override] of Object.entries(
          perImplementation as Record<string, unknown>,
        )) {
          if (implementationName === IOC_CONTRACT_CONFIG_KEY) {
            continue;
          }
          if (
            typeof override !== "object" ||
            override === null ||
            !("source" in override)
          ) {
            continue;
          }
          const sourcePath = [
            "registrations",
            contractName,
            implementationName,
            "source",
          ];
          if (!inAppMode) {
            ctx.addIssue({
              code: "custom",
              message: "is only valid when composedManifests is set (app mode)",
              path: sourcePath,
            });
            continue;
          }
          const source = (override as { source?: unknown }).source;
          if (typeof source !== "string" || source === "local") {
            continue;
          }
          if (!composedSet.has(source)) {
            ctx.addIssue({
              code: "custom",
              message: `references ${JSON.stringify(source)}, which is not listed in composedManifests`,
              path: sourcePath,
            });
          }
        }
      }
    }
  });

// ---------------------------------------------------------------------------------------------
// issue formatting
// ---------------------------------------------------------------------------------------------

/**
 * Renders an issue path in the house formats of the previous hand validators:
 * `registrations["Contract"]["impl"].lifetime`, `groups."name".baseTypeArg`,
 * `lifetimeMarkers."IScoped"`, `discovery.scanDirs[0].scope`, `scopeProvided[1]`.
 */
const renderConfigPath = (path: readonly PropertyKey[]): string => {
  const segments = path.filter(
    (seg): seg is string | number => typeof seg !== "symbol",
  );
  const first = segments[0];
  let out = "";
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (typeof seg === "number") {
      out += `[${seg}]`;
    } else if (i === 0) {
      out += seg;
    } else if (first === "registrations" && i <= 2) {
      out += `[${JSON.stringify(seg)}]`;
    } else if (
      (first === "groups" ||
        first === "classes" ||
        first === "lifetimeMarkers" ||
        first === "groupBaseTypeAliases") &&
      i === 1
    ) {
      out += `.${JSON.stringify(seg)}`;
    } else {
      out += `.${seg}`;
    }
  }
  return out;
};

const GROUP_ENTRY_UNKNOWN_KEY_SUFFIX = ` (only ${GROUP_ENTRY_ALLOWED_KEYS.slice(0, -1).join(", ")} and ${GROUP_ENTRY_ALLOWED_KEYS.at(-1)} are allowed)`;

const CLASS_ENTRY_UNKNOWN_KEY_SUFFIX = ` (only ${CLASS_ENTRY_ALLOWED_KEYS.slice(0, -1).join(", ")} and ${CLASS_ENTRY_ALLOWED_KEYS.at(-1)} are allowed)`;

const formatIocConfigIssue = (
  issue: z.core.$ZodIssue,
  sourceLabel: string,
): string[] => {
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => {
      if (
        issue.path.length === 1 &&
        issue.path[0] === "discovery" &&
        key === "workspacePackageImportBases"
      ) {
        return `[ioc-config] ${sourceLabel} discovery.workspacePackageImportBases was removed in v2; use composedManifests instead.`;
      }
      const suffix =
        issue.path.length === 2 && issue.path[0] === "groups"
          ? GROUP_ENTRY_UNKNOWN_KEY_SUFFIX
          : issue.path.length === 2 && issue.path[0] === "classes"
            ? CLASS_ENTRY_UNKNOWN_KEY_SUFFIX
            : "";
      const prefix =
        issue.path.length === 0 ? "" : `${renderConfigPath(issue.path)} `;
      return `[ioc-config] ${sourceLabel} ${prefix}has unknown property ${JSON.stringify(key)}${suffix}`;
    });
  }

  if (isStandaloneIssue(issue) || issue.message === "is missing discovery") {
    return [`[ioc-config] ${sourceLabel} ${issue.message}`];
  }

  const rendered = renderConfigPath(issue.path);
  return [
    rendered.length === 0
      ? `[ioc-config] ${sourceLabel} ${issue.message}`
      : `[ioc-config] ${sourceLabel} ${rendered} ${issue.message}`,
  ];
};

export const formatIocConfigIssues = (
  error: z.ZodError,
  sourceLabel: string,
): string =>
  error.issues.flatMap((issue) => formatIocConfigIssue(issue, sourceLabel)).join("\n");

/**
 * Formats issues from {@link contractMetadataSchema} against a caller-supplied path label
 * (`registrations["Contract"]["$contract"]`), preserving the messages of the previous
 * hand-rolled `parseContractLevelConfig`.
 */
export const formatContractMetadataIssues = (
  error: z.ZodError,
  pathForError: string,
): string =>
  error.issues
    .flatMap((issue) => {
      if (issue.code === "unrecognized_keys") {
        return issue.keys.map(
          (key) =>
            `[ioc-config] ${pathForError} has unknown property ${JSON.stringify(key)}${CONTRACT_METADATA_UNKNOWN_KEY_SUFFIX}`,
        );
      }
      if (issue.code === "invalid_type" && issue.path.length === 0) {
        return [`[ioc-config] ${pathForError} must be an object`];
      }
      const rel = issue.path.length === 0 ? "" : `.${issue.path.join(".")}`;
      return [`[ioc-config] ${pathForError}${rel} ${issue.message}`];
    })
    .join("\n");
