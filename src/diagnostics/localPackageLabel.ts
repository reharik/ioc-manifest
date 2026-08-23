/**
 * @fileoverview How the RUNNING package is named in human output.
 *
 * ### The complaint this answers
 *
 * `"local"` is the tool's internal token for the package a command is running in. It is the right
 * token — it is what `registrations.<C>.<impl>.source` accepts, what a slice's `sourceId` carries,
 * and what `--json` consumers match on — and it must not move. What it is not is a WORD: printed
 * into prose it reads as a proper noun the reader was never introduced to, as in
 *
 * > nothing supplies "activatePendingUserWriteService", which local expects the container to
 * > already have
 *
 * where "local" is doing the work of a package name and looks like one. A reader with three
 * packages open cannot tell which one is being talked about.
 *
 * ### The rule
 *
 * Human output names the running package by its own name and puts the ROLE in parentheses —
 * `@apps/api (this app)`. When no name is resolvable (`config.packageName` unset), the role alone
 * stands in: `this app`. Nothing renders the bare token.
 *
 * Where the attribution is already parenthetical — a walk path whose composed units print
 * `(composed package "@x/y")` — the local half is the symmetric `(this app)`. The package's own
 * name adds nothing there: the path beside it is a path in this repository, which is exactly what
 * the parenthetical is saying.
 *
 * `--json` is untouched. The token stays the token; this is rendering.
 */
import { LOCAL_PACKAGE_IDENTIFIER } from "../config/packageIdentifier.js";

/** The role, in the words a reader already has: the package they are standing in. */
export const LOCAL_PACKAGE_ROLE = "this app";

/**
 * The parenthetical form, symmetric with `(composed package "@x/y")` on a walk path.
 */
export const LOCAL_PACKAGE_ATTRIBUTION = `(${LOCAL_PACKAGE_ROLE})`;

/**
 * The running package as PROSE names it: `@apps/api (this app)`, or `this app` when it has no
 * resolvable name.
 *
 * The bare token is treated as "no name": a slice built before `config.packageName` was set carries
 * `"local"` as its label, and printing that is the very thing this module exists to stop.
 */
export const localPackageProse = (packageName: string | undefined): string =>
  packageName === undefined ||
  packageName.length === 0 ||
  packageName === LOCAL_PACKAGE_IDENTIFIER
    ? LOCAL_PACKAGE_ROLE
    : `${packageName} (${LOCAL_PACKAGE_ROLE})`;
