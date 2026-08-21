/* Deliberately PRE-ROOT stand-in for prior generated output.

Written by a generation that ran BEFORE `build__AuthService` gained its `ScopeRoot` annotation, so
it knows nothing about `openAuthServiceScope`: no cradle key, no opener alias. That is the whole
point — the consumer next door names both, and the run that must resolve them is the run that first
discovers the root. `StaleClock` is the tell: nothing here may reach an analysis result.
*/

export interface StaleClock {
  now: () => number;
}

export interface IocGeneratedCradle {
  staleClock: StaleClock;
}
