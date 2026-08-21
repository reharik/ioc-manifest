/**
 * @fileoverview Entry-point barrel for the type-emission seam. This is the ONLY module other
 * generator code may import from `src/generator/emit/` — the sibling files are internals kept
 * strict in preparation for possible future extraction. Context flows through one explicit
 * options object ({@link EmitTypeReferenceContext}; specifier recovery takes the
 * {@link PreferredSpecifierContext} slice of it), never ad-hoc parameters.
 */
export {
  EmitTypeReferenceError,
  emitTypeReference,
  formatTypeDisplay,
  isUnresolvableDepsPropertyType,
  tryEmitTypeReference,
  type EmitTypeReferenceContext,
  type TryEmitTypeReferenceOptions,
} from "./emitTypeReference.js";
export {
  EmitImportClosureError,
  verifyImportClosure,
  type VerifyImportClosureContext,
} from "./verifyImportClosure.js";
export {
  factoryBareImportLocalBindingName,
  factoryImportsTypeAsDefaultBareImport,
  tryRecoverPreferredModuleSpecifier,
  type PreferredSpecifierContext,
} from "./recoverPreferredModuleSpecifier.js";
export type {
  EmittedTypeReference,
  FactorySourceLocation,
  TypeImportSpec,
} from "./types.js";
