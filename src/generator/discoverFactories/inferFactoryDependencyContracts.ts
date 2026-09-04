import ts from "typescript";

const unwrapPromiseType = (checker: ts.TypeChecker, t: ts.Type): ts.Type => {
  const sym = t.getSymbol();
  const symName = sym?.getName();
  if (symName === "Promise") {
    const args = checker.getTypeArguments(t as ts.TypeReference);
    if (args.length > 0) {
      return unwrapPromiseType(checker, args[0]);
    }
  }
  return t;
};

/**
 * Which written shape defeated the key analysis.
 *
 * `dependencyKeysUnknown` says only THAT the demand set could not be read. The author of the
 * factory needs to know WHY, in the terms they wrote it in — the fix is a one-line edit at a site
 * only this value can point at. Every branch that yields no keys names itself here, so no offender
 * is ever reported as a generic "could not read".
 */
export type DependencyKeysUnknownShape =
  /** `(deps: Deps)` — a plain identifier parameter. The common, idiomatic, unreadable one. */
  | "non-destructured-parameter"
  /** `(deps: Deps = { ... })` — non-destructured AND defaulted; the default is not the problem. */
  | "defaulted-parameter"
  /** `([a, b]: Deps)` — an array binding pattern; the cradle is an object, not a tuple. */
  | "array-binding-parameter"
  /** `({ a, ...rest }: Deps)` — a rest element silently widens demand past the names it lists. */
  | "rest-element"
  /** `({ logger: { log } }: Deps)` — a nested pattern; the bound name is not a cradle key. */
  | "nested-binding"
  /** `({ [KEY]: v }: Deps)` — a computed property name, not knowable before it runs. */
  | "computed-property"
  /** `({ a }: SomeCallable)` — the parameter type is a function type, so it has no cradle keys. */
  | "callable-parameter-type"
  /** The checker produced no signature, or no declared parameter node, for the unit. */
  | "unresolvable-signature";

/**
 * Property names read from the object binding pattern (first parameter only), or the
 * {@link DependencyKeysUnknownShape} that made them unreadable.
 * - Rest elements (`...rest`) => unknown (too broad).
 * - Nested binding patterns => unknown (not direct top-level cradle picks).
 * - Computed / non-literal property names => unknown.
 */
const getBindingPatternPropertyNames = (
  pattern: ts.ObjectBindingPattern,
): DependencyKeysUnknownShape | string[] => {
  const names: string[] = [];
  for (const el of pattern.elements) {
    if (!ts.isBindingElement(el)) {
      continue;
    }
    if (el.dotDotDotToken !== undefined) {
      return "rest-element";
    }
    if (!ts.isIdentifier(el.name)) {
      return "nested-binding";
    }
    if (el.propertyName === undefined) {
      names.push(el.name.text);
      continue;
    }
    if (ts.isIdentifier(el.propertyName)) {
      names.push(el.propertyName.text);
      continue;
    }
    if (ts.isStringLiteral(el.propertyName)) {
      names.push(el.propertyName.text);
      continue;
    }
    return "computed-property";
  }
  return names;
};

const addContractNamesFromType = (
  checker: ts.TypeChecker,
  t: ts.Type,
  knownContractNames: ReadonlySet<string>,
  out: Set<string>,
): void => {
  const apparent = unwrapPromiseType(checker, checker.getApparentType(t));
  if (apparent.isUnion()) {
    for (const u of apparent.types) {
      addContractNamesFromType(checker, u, knownContractNames, out);
    }
    return;
  }
  if (apparent.isIntersection()) {
    for (const u of apparent.types) {
      addContractNamesFromType(checker, u, knownContractNames, out);
    }
    return;
  }
  const sym = apparent.aliasSymbol ?? apparent.getSymbol();
  const name = sym?.getName();
  if (name !== undefined && knownContractNames.has(name)) {
    out.add(name);
  }
};

export type InferredFactoryDependencies = {
  contractNames: string[];
  /** Cradle keys from the binding pattern; omitted when rest/nested/computed rules apply. */
  dependencyKeys?: string[];
  /**
   * True when the demand set could not be DETERMINED — as opposed to determined and found empty.
   *
   * Both come back with no `dependencyKeys`, and telling them apart is the whole difference
   * between a manifest that can honestly claim `"dependencyKeysComplete"` and one that cannot.
   * A factory declaring no parameters demands nothing and is known to; a factory written
   * `(deps: Deps)`, `({ a, ...rest }: Deps)` or with a computed key demands whatever it demands
   * and this analysis cannot say what.
   */
  dependencyKeysUnknown?: true;
  /**
   * Which written shape defeated the analysis. Always set alongside `dependencyKeysUnknown` and
   * never without it: the boolean is what the manifest's coverage claim folds in, this is what a
   * generation-time diagnostic quotes back to the author.
   */
  dependencyKeysUnknownShape?: DependencyKeysUnknownShape;
};

/** Determined, and determined to be empty: the unit demands nothing. */
const NO_DEPENDENCIES: InferredFactoryDependencies = { contractNames: [] };

/** Not determined: the deps parameter is a shape this syntactic analysis cannot read. */
const unknownDependencies = (
  shape: DependencyKeysUnknownShape,
): InferredFactoryDependencies => ({
  contractNames: [],
  dependencyKeysUnknown: true,
  dependencyKeysUnknownShape: shape,
});

/**
 * Infers dependency contract names and cradle keys from the factory's first parameter **object
 * binding pattern** only: for `({ config, logger }: SomeCradleType)`, resolves the type of
 * `config` and `logger` on the parameter type and collects symbols that match known contract
 * names; `dependencyKeys` holds the destructured property names (e.g. `config`, `logger`).
 *
 * Does **not** walk all properties of the cradle type (avoids listing the entire container graph).
 * If the first parameter is not a top-level object binding pattern, returns empty contract names
 * and omits keys (prefer omission) — flagged {@link InferredFactoryDependencies.dependencyKeysUnknown}
 * so a caller can tell that omission apart from a unit that genuinely demands nothing.
 */
export const inferFactoryDependencies = (
  checker: ts.TypeChecker,
  factoryDecl: ts.FunctionLike,
  knownContractNames: ReadonlySet<string>,
): InferredFactoryDependencies => {
  // No early return on an empty `knownContractNames`. It narrows which dependencies are named as
  // CONTRACTS and has no bearing on the cradle KEYS, which are binding names: gating the whole
  // inference on it left a package with no local contracts — a thin composition app whose graph
  // lives entirely in composed libraries — with no dependency keys at all, and therefore with a
  // scope-root subtree walk that never got past its own root.
  const signature = checker.getSignatureFromDeclaration(factoryDecl);
  if (!signature) {
    return unknownDependencies("unresolvable-signature");
  }

  // Declaring no parameters is the one unambiguous answer in this function: a unit that takes
  // nothing from the cradle demands nothing from it.
  const params = signature.getParameters();
  if (params.length === 0) {
    return NO_DEPENDENCIES;
  }

  const paramNode = factoryDecl.parameters[0];
  if (!paramNode) {
    return unknownDependencies("unresolvable-signature");
  }

  // `(deps: Deps)` — the idiomatic non-destructured factory. It demands whatever it reads off
  // `deps` at runtime, and this analysis reads binding names, so the answer is "unknown", never
  // "none". The default initializer is reported ahead of the missing destructuring because the two
  // together (`(deps: Deps = {})`) have one fix, and it is not "drop the default".
  if (!ts.isObjectBindingPattern(paramNode.name)) {
    if (paramNode.initializer !== undefined) {
      return unknownDependencies("defaulted-parameter");
    }
    return unknownDependencies(
      ts.isArrayBindingPattern(paramNode.name)
        ? "array-binding-parameter"
        : "non-destructured-parameter",
    );
  }

  const boundNames = getBindingPatternPropertyNames(paramNode.name);
  if (!Array.isArray(boundNames)) {
    return unknownDependencies(boundNames);
  }
  // `({}: Deps)` destructures nothing out of a cradle it does name: determined, and empty.
  if (boundNames.length === 0) {
    return NO_DEPENDENCIES;
  }

  const p0 = params[0]!;
  const paramType = checker.getTypeOfSymbolAtLocation(p0, paramNode);
  const resolvedParam = checker.getApparentType(paramType);

  if (resolvedParam.getCallSignatures().length > 0) {
    return unknownDependencies("callable-parameter-type");
  }

  const out = new Set<string>();
  for (const propName of boundNames) {
    const prop = checker.getPropertyOfType(resolvedParam, propName);
    if (!prop) {
      continue;
    }
    const propType = checker.getTypeOfSymbol(prop);
    addContractNamesFromType(checker, propType, knownContractNames, out);
  }

  return {
    contractNames: Array.from(out).sort((a, b) => a.localeCompare(b)),
    dependencyKeys: boundNames,
  };
};

/**
 * Infers dependency contract names from the factory's first parameter **object binding pattern**
 * only: for `({ config, logger }: SomeCradleType)`, resolves the type of `config` and `logger` on
 * the parameter type and collects symbols that match known contract names.
 *
 * Does **not** walk all properties of the cradle type (avoids listing the entire container graph).
 * If the first parameter is not a top-level object binding pattern, returns [] (prefer omission).
 */
export const inferDependencyContractNames = (
  checker: ts.TypeChecker,
  factoryDecl: ts.FunctionLike,
  knownContractNames: ReadonlySet<string>,
): string[] =>
  inferFactoryDependencies(checker, factoryDecl, knownContractNames)
    .contractNames;
