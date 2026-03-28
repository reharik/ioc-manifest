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
 * Best-effort: reads the first parameter type as an object and collects property value types
 * whose symbol name matches a known contract name (from discovery).
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

  const p0 = params[0]!;
  const paramNode = factoryDecl.parameters[0];
  if (!paramNode) {
    return [];
  }

  const pType = checker.getTypeOfSymbolAtLocation(p0, paramNode);
  const t = unwrapPromiseType(checker, checker.getApparentType(pType));

  if (t.getCallSignatures().length > 0) {
    return [];
  }

  const out = new Set<string>();
  for (const prop of checker.getPropertiesOfType(t)) {
    const pt = checker.getTypeOfSymbol(prop);
    const apparent = unwrapPromiseType(checker, checker.getApparentType(pt));
    const sym = apparent.aliasSymbol ?? apparent.getSymbol();
    const name = sym?.getName();
    if (name !== undefined && knownContractNames.has(name)) {
      out.add(name);
    }
  }

  return Array.from(out).sort((a, b) => a.localeCompare(b));
};
