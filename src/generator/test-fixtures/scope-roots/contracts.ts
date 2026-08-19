export interface IRouter {
  handle: (path: string) => string;
}

/** An ordinary contract in the same fixture, to pin that scope-root discovery changes nothing here. */
export interface Clock {
  now: () => number;
}

export type ViewerId = string & { readonly __viewer?: unique symbol };

export interface UnitOfWork {
  commit: () => Promise<void>;
}
