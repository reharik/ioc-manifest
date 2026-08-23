/**
 * @fileoverview The name a composition slice is printed under.
 *
 * One function, used by every check that names a package in prose, so the composition report cannot
 * name the same slice two ways. A COMPOSED slice is already labelled with its npm name and needs
 * nothing; the LOCAL slice is the one that has been rendering as the internal token `"local"` — see
 * `diagnostics/localPackageLabel.ts` for why that reads badly and what replaces it.
 *
 * Locality is read from `sourceId`, never from the label: `sourceId` is the machine token and is
 * `"local"` for the running package regardless of whether a name was resolvable for it.
 */
import { LOCAL_PACKAGE_IDENTIFIER } from "../config/packageIdentifier.js";
import { localPackageProse } from "../diagnostics/localPackageLabel.js";

/** True when this slice is the package the command is running in. */
export const isLocalSlice = (slice: { readonly sourceId: string }): boolean =>
  slice.sourceId === LOCAL_PACKAGE_IDENTIFIER;

/**
 * The slice's name for human output: the composed package's npm name, or the local package as
 * `@apps/api (this app)` / `this app`.
 */
export const sliceLabel = (slice: {
  readonly packageLabel: string;
  readonly sourceId: string;
}): string =>
  isLocalSlice(slice) ? localPackageProse(slice.packageLabel) : slice.packageLabel;
