import type { GraphQLServer, KnexConfig } from "./contracts.js";
import type { Logger } from "./contracts.js";

type KnexConfigDeps = {
  config: import("./contracts.js").Config;
  logger: Logger;
};

/** Low-level: only config + logger from the wide cradle — must not pull GraphQLServer, KoaServer, etc. */
export const buildKnexConfig = ({
  config,
  logger,
}: KnexConfigDeps): KnexConfig => {
  logger.log(config.env);
  return { client: "pg" };
};

type GraphQLServerDeps = {
  logger: Logger;
};

/** High-level service: only logger — must not infer GraphQLServer as a dependency. */
export const buildGraphQLServer = ({ logger }: GraphQLServerDeps): GraphQLServer => {
  return { listen: () => logger.log("ok") };
};

type FullCradleParamDeps = {
  logger: Logger;
};

/** Single identifier parameter typed as named deps — omit dependency list. */
export const buildWithFullCradleParam = (deps: FullCradleParamDeps): KnexConfig => {
  deps.logger.log("x");
  return { client: "pg" };
};

type WithRestDeps = {
  logger: Logger;
};

/** Rest element in binding — omit (would require whole-object semantics). */
export const buildWithRest = ({
  logger,
  ...rest
}: WithRestDeps): KnexConfig => {
  void rest;
  logger.log("x");
  return { client: "pg" };
};

type GraphQLServerWithExplicitSelfDeps = {
  graphqlServer: GraphQLServer;
  logger: Logger;
};

/** Explicitly destructures own contract slot — allowed to include GraphQLServer. */
export const buildGraphQLServerWithExplicitSelf = ({
  graphqlServer,
  logger,
}: GraphQLServerWithExplicitSelfDeps): GraphQLServer => {
  logger.log("x");
  return graphqlServer;
};

type NarrowDeps = {
  logger: Logger;
};

/** Narrow deps type (only selected keys in the type) — still binding-pattern based. */
export const buildFromNarrowDeps = ({ logger }: NarrowDeps): KnexConfig => {
  logger.log("x");
  return { client: "pg" };
};

type RenamedBindingDeps = {
  logger: Logger;
};

/** Renamed binding: property key on cradle is still `logger`. */
export const buildRenamedBinding = ({
  logger: logSvc,
}: RenamedBindingDeps): KnexConfig => {
  logSvc.log("x");
  return { client: "pg" };
};

type SimpleAbDeps = {
  a: Logger;
  b: Logger;
};

/** Simple two-key binding for dependencyKeys coverage. */
export const buildSimpleAb = ({ a, b }: SimpleAbDeps): KnexConfig => {
  a.log("x");
  b.log("y");
  return { client: "pg" };
};

type NestedBindingDeps = {
  logger: Logger;
};

/** Nested binding pattern in first parameter — omit dependencyKeys. */
export const buildNestedBinding = ({
  logger: { log },
}: NestedBindingDeps): KnexConfig => {
  log("x");
  return { client: "pg" };
};

type ComputedBindingDeps = {
  logger: Logger;
};

const LOGGER_KEY = "logger";

/** Computed property name in binding — omit dependencyKeys. */
export const buildComputedBinding = ({
  [LOGGER_KEY]: logSvc,
}: ComputedBindingDeps): KnexConfig => {
  logSvc.log("x");
  return { client: "pg" };
};
