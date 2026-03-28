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
 * Property names read from the object binding pattern (first parameter only).
 * - Rest elements (`...rest`) => omit (too broad).
 * - Nested binding patterns => omit (not direct top-level cradle picks).
 * - Computed / non-literal property names => omit.
 */
const getBindingPatternPropertyNames = (
  pattern: ts.ObjectBindingPattern,
): "omit" | string[] => {
  const names: string[] = [];
  for (const el of pattern.elements) {
    if (!ts.isBindingElement(el)) {
      continue;
    }
    if (el.dotDotDotToken !== undefined) {
      return "omit";
    }
    if (!ts.isIdentifier(el.name)) {
      return "omit";
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
    return "omit";
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
): string[] => {
  if (knownContractNames.size === 0) {
    return [];
  }

  const signature = checker.getSignatureFromDeclaration(factoryDecl);
  if (!signature) {
    return [];
  }

  const params = signature.getParameters();
  if (params.length === 0) {
    return [];
  }

  const paramNode = factoryDecl.parameters[0];
  if (!paramNode) {
    return [];
  }

  if (!ts.isObjectBindingPattern(paramNode.name)) {
    return [];
  }

  const boundNames = getBindingPatternPropertyNames(paramNode.name);
  if (boundNames === "omit") {
    return [];
  }
  if (boundNames.length === 0) {
    return [];
  }

  const p0 = params[0]!;
  const paramType = checker.getTypeOfSymbolAtLocation(p0, paramNode);
  const resolvedParam = checker.getApparentType(paramType);

  if (resolvedParam.getCallSignatures().length > 0) {
    return [];
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

  return Array.from(out).sort((a, b) => a.localeCompare(b));
};
