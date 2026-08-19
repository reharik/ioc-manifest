import ts from "typescript";
import type { IocConfig, IocLifetime } from "../config/iocConfig.js";
import type { IocUnitKind } from "../core/manifest.js";
import type { IocDiscoveryStrategy } from "./discoverFactories/discoveryOutcomeTypes.js";
import type { FactoryDiscoveryPaths } from "./manifestPaths.js";

/**
 * One discovered factory export in a source file.
 * `contractTypeRelImport` is the module that declares the contract type symbol
 * (from the TypeScript checker), used for generated type-only imports — independent of default selection.
 */
export type DiscoveredFactory = {
  /**
   * Which registration unit kind this row came from. Absent reads as `"factory"` (the historical
   * and overwhelmingly common case); `"class"` for an exported class discovered via `implements`.
   */
  unitKind?: IocUnitKind;
  contractName: string;
  /**
   * Absolute (normalized) path of the file declaring the contract type. Always set by discovery
   * (optional only for hand-built test rows). Canonical contract identity is the pair
   * (contractDeclAbsPath, contractName); discovery fails hard when two different declarations
   * would otherwise merge under one manifest key.
   */
  contractDeclAbsPath?: string;
  /**
   * Module specifier for generated type-only imports: relative to the generated dir, a bare
   * package name (e.g. `knex`), or a workspace alias — not a path through `node_modules`.
   */
  contractTypeRelImport: string;
  implementationName: string;
  exportName: string;
  registrationKey: string;
  modulePath: string;
  relImport: string;
  default?: boolean;
  lifetime?: IocLifetime;
  /** Set when the export matched a discovery strategy. */
  discoveredBy?: IocDiscoveryStrategy;
  /** Contract types inferred from the factory deps parameter (see manifest metadata). */
  dependencyContractNames?: string[];
  /** Cradle keys demanded by this factory's deps destructuring (gen-time edge for
      lifetime-inversion analysis). Same omit rules as dependencyContractNames. */
  dependencyKeys?: string[];
};

/**
 * One discovered scope-root registration unit (stage 1).
 *
 * Deliberately NOT a {@link DiscoveredFactory}: a scope root claims no cradle key, elects no
 * default, and reaches no manifest at this stage, so it is kept out of the contract map rather than
 * flowing into the registration plan. See `docs/design/scope-roots.md` for why the stage-1 boundary
 * is "discovered and reported, not manifest-emitted".
 */
export type DiscoveredScopeRoot = {
  /** Always true — the marker on the row, so consumers read intent rather than infer it. */
  isScopeRoot: true;
  /** Root contract resolved from the marker's first type argument, via the ordinary identity path. */
  contractName: string;
  /** Absolute (normalized) path of the file declaring the root contract type. */
  contractDeclAbsPath: string;
  /**
   * Factory identity within the root contract's variant set — the derived implementation name
   * (`buildAuthRouter` → `authRouter`). The variant is ALWAYS the factory identity, never a type
   * parameter.
   */
  variantName: string;
  exportName: string;
  modulePath: string;
  relImport: string;
  unitKind: IocUnitKind;
  /**
   * The declared late-bound-value type argument, captured verbatim. Stage 1 never resolves or
   * verifies it; stage 2 checks it against the subtree's scope-demands.
   */
  lbvTypeNode: ts.TypeNode;
  /** `lbvTypeNode` source text, so reporting needs no AST. */
  lbvTypeText: string;
  /** Always `"scoped"`: a scope root is resolved per scope by construction, not by policy. */
  lifetime: IocLifetime;
};

export type FactoryDiscoveryFileContext = {
  absPath: string;
  sourceFile: ts.SourceFile;
  projectRoot: string;
  factoryPrefix: string;
  paths: FactoryDiscoveryPaths;
  /** When set, `registrations[contract][implementation].name` participates in registration key resolution. */
  iocConfig?: IocConfig;
};
