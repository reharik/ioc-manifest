// Mirrors the `type KnexConfig = Knex.Config` case: an alias of a generic whose sole
// type parameter has a default. The resolved type is `Cfg<any>` (the default filled in),
// but the alias `AppConfig` is itself non-generic, so emitting `AppConfig<any>` is a
// TS2315 error. The correct output is the bare `AppConfig`.
export interface Cfg<SV extends {} = any> {
  client: string;
  seedValue: SV;
}

export type AppConfig = Cfg;

export const buildAppConfig = (): AppConfig => ({
  client: "pg",
  seedValue: {},
});

// A generic referenced with a bare, unresolved type parameter. The printed name is
// `Cfg` (arity 1) but its single argument is the unresolved `T`, so the conservative
// output is the bare `Cfg` with no type-argument brackets and no throw.
export const buildOpenConfig = <T,>(): Cfg<T> => ({
  client: "pg",
  seedValue: undefined as T,
});
