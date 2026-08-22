import type { RequestPipeline, Strategy } from "./contracts.js";

/**
 * Demands the contract key of a group base that elects no default.
 *
 * No election, no slot key — so this is an ordinary unsatisfied demand and reaches `IocExternals`,
 * exactly as a demand for any unregistered name does.
 */
type StrategyConsumerDeps = { strategy: Strategy };

export const buildStrategyConsumer = ({
  strategy,
}: StrategyConsumerDeps): RequestPipeline => ({
  run: () => strategy.id,
});
