export interface IScoped {
  readonly __brand: "IScoped";
}

export interface ITransient {
  readonly __transientBrand: "ITransient";
}

export interface ScopedService extends IScoped {
  readonly __brand: "IScoped";
  readonly label: string;
}

export interface DualMarked extends IScoped, ITransient {
  readonly __brand: "IScoped";
  readonly __transientBrand: "ITransient";
  readonly id: string;
}

export interface PlainService {
  readonly id: string;
}
