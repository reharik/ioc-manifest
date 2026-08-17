/* Deliberately STALE stand-in for prior generated output.

Every type here resolves to `StaleContract`, which no factory in these fixtures supplies. Any
resolution path that type-checks this file instead of claiming the reference syntactically shows up
in the analysis result as `StaleContract` — that is how the tests tell a resolved form from one that
fell through. The `cold/` fixtures have no generated file at all, which is the other half of the
same check.
*/
import type { StaleContract } from "../contracts.js";

export interface IocGeneratedCradle {
  storage: StaleContract;
  channels: ReadonlyArray<StaleContract>;
  uploadService: StaleContract;
}

export type Channels = ReadonlyArray<StaleContract>;

export interface IocExternals {
  config: StaleContract;
}

export interface IocScopeProvided {}
