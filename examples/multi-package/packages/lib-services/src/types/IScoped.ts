/** Lifetime marker: only types that declare this member inherit scoped lifetime. */
export interface IScoped {
  readonly __iocLifetimeScoped: true;
}
