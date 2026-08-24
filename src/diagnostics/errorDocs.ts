/**
 * @fileoverview The one place a diagnostic code is mapped to a documentation page.
 *
 * ### Why a map rather than a URL in the message
 *
 * Every diagnostic this tool raises has three registers: a plain-language sentence saying what
 * happened, the mechanism (the key, the contract, the file and line), and a pointer to the page
 * that ARTICULATES the rule. The third register is the one that keeps the first two short — an
 * error does not have to teach the demand model inline if it can name the chapter that does.
 *
 * Hand-writing those URLs into message strings is how they rot: a heading gets renamed, the link
 * 404s, and nothing fails until a developer follows it. So the URLs live here, one entry per code,
 * and `errorDocs.test.ts` resolves every one of them against the markdown the site is built from —
 * a renamed heading fails the suite instead of a user's click.
 *
 * A code may legitimately have NO entry. Absence means "no page says this yet", the pointer is
 * omitted, and the message stands on its first two registers. Inventing a link to a page that does
 * not exist is the one outcome this module exists to prevent.
 */

/** The published docs site (`docs/.vitepress/config.ts` `base`, on GitHub Project Pages). */
export const IOC_DOCS_BASE_URL = "https://reharik.github.io/ioc-manifest/";

/**
 * Site-relative doc targets by diagnostic code, `page#anchor`.
 *
 * Keys are the codes as they are PRINTED — the bracketed tag on a demand-model offender, the
 * `category` of a composition issue, the `code` of a scope-root verification finding. That is
 * deliberate: the lookup key is what a reader (or an agent grepping output) already has in hand.
 */
const DOC_TARGET_BY_CODE: Readonly<Record<string, string>> = {
  // ── The demand model: a deps property names one of five things ────────────────────────────────
  "named-marker-required":
    "concepts/conventions#demanding-a-dependency-the-five-things-a-deps-property-can-be",
  "named-contract-mismatch":
    "concepts/conventions#demanding-a-dependency-the-five-things-a-deps-property-can-be",
  "named-on-contract-key":
    "concepts/conventions#demanding-a-dependency-the-five-things-a-deps-property-can-be",
  "named-on-group-key":
    "concepts/conventions#demanding-a-dependency-the-five-things-a-deps-property-can-be",
  "named-on-opener-key":
    "concepts/conventions#demanding-a-dependency-the-five-things-a-deps-property-can-be",
  "named-unknown-key":
    "concepts/conventions#demanding-a-dependency-the-five-things-a-deps-property-can-be",
  "named-wrong-arity":
    "concepts/conventions#demanding-a-dependency-the-five-things-a-deps-property-can-be",
  // Not the demand model but the group law — the fix is "consume the group", not "spell it better".
  "grouped-member-demand": "concepts/groups#grouped-means-group-only",
  /**
   * The FAMILY pointer for the aggregated demand-model error's preamble. Not a code any offender
   * prints: the preamble states the rule once, so it links the rule once, and an offender line only
   * repeats a link when its own code points somewhere else.
   */
  "demand-model":
    "concepts/conventions#demanding-a-dependency-the-five-things-a-deps-property-can-be",

  /**
   * Contract identity: the annotated type must be a name-importable declaration. One code, one
   * spelling — the discovery report prints it as the skip reason and the aggregated generation
   * error prints it as its bracketed code, so both look the rule up here.
   */
  contract_annotation_default_export:
    "guide/adopting#foreign-types-need-local-names",

  // ── Lifetimes ─────────────────────────────────────────────────────────────────────────────────
  "lifetime-inversion": "concepts/lifetimes#the-floor-rule",
  lifetime_inversion: "concepts/lifetimes#the-floor-rule",
  "group-lifetime-on-member": "concepts/groups#lifetime-belongs-to-the-group",
  "group-lifetime-config-override": "concepts/groups#lifetime-belongs-to-the-group",
  /** Family pointer for the aggregated group-lifetime error's preamble. */
  "group-lifetime": "concepts/groups#lifetime-belongs-to-the-group",

  // ── Scope roots ───────────────────────────────────────────────────────────────────────────────
  lbv_missing_key: "concepts/scope-roots#missing-keys",
  lbv_type_mismatch: "concepts/scope-roots#type-mismatches",
  lbv_unused_key: "concepts/scope-roots#unused-declared-keys",
  lbv_composed_blind_spot: "concepts/scope-roots#composed-blind-spots",
  "scope-root-verification": "concepts/scope-roots#verification",

  // ── Composition suite categories (`ioc validate` / app-mode `ioc generate`) ────────────────────
  externals: "monorepo/composition#externals",
  "registry-integrity": "reference/cli#ioc-validate",
  "same-key-conflict": "monorepo/composition#resolving-same-key-conflicts",
  "group-kind": "monorepo/composition#groups-across-manifests",
  "group-base-type": "monorepo/composition#groups-across-manifests",
  "group-key-conflict": "monorepo/composition#groups-across-manifests",
  "default-ambiguity": "concepts/conventions#default-implementation-selection",
  "slot-occupancy": "concepts/conventions#contract-slot-keys",
  "app-config": "config/reference#registrations",
  "unused-config": "config/reference#registrations",

  // ── The CLI's own help output ─────────────────────────────────────────────────────────────────
  /**
   * Not diagnostic codes — but the same third register, and the same rot.
   *
   * `ioc --help` and each verb's `--help` page end on a docs pointer, and a pointer hand-written
   * into a help string 404s exactly the way one hand-written into an error message does. Keying
   * them here puts them under `errorDocs.test.ts`, which resolves every anchor against the markdown
   * the site is built from. `generate` has no dedicated reference section, so it points at the one
   * chapter headed with its name; `inspect` gained one in the same pass that added this map.
   */
  "cli-command-map": "reference/cli#the-command-map",
  "cli-verb-generate":
    "reference/cli#ioc-generate-in-app-mode-the-composition-suite",
  "cli-verb-inspect": "reference/cli#ioc-inspect",
  "cli-verb-explain": "reference/cli#ioc-explain-key",
  "cli-verb-validate": "reference/cli#ioc-validate",
};

/** Every code that carries a pointer, sorted — the surface `errorDocs.test.ts` walks. */
export const IOC_DOCUMENTED_DIAGNOSTIC_CODES: readonly string[] =
  Object.keys(DOC_TARGET_BY_CODE).sort((a, b) => a.localeCompare(b));

/** Site-relative `page#anchor` for a code, or `undefined` when no page covers it yet. */
export const docsTargetForCode = (code: string): string | undefined =>
  DOC_TARGET_BY_CODE[code];

/** Absolute docs URL for a code, or `undefined` when no page covers it yet. */
export const docsUrlForCode = (code: string): string | undefined => {
  const target = DOC_TARGET_BY_CODE[code];
  return target === undefined ? undefined : `${IOC_DOCS_BASE_URL}${target}`;
};

/**
 * The third register, ready to append: `" → docs: <url>"`, or the empty string when the code has
 * no page. Callers concatenate unconditionally — an undocumented code simply adds nothing.
 */
export const docsPointerSuffix = (code: string): string => {
  const url = docsUrlForCode(code);
  return url === undefined ? "" : ` → docs: ${url}`;
};

/**
 * The third register as a LINE of its own — for a diagnostic whose plain-language sentence stands
 * apart from its per-offender mechanism. `undefined` when the code has no page.
 */
export const docsPointerLine = (code: string): string | undefined => {
  const url = docsUrlForCode(code);
  return url === undefined ? undefined : `→ docs: ${url}`;
};
