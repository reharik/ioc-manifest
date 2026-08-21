declare const brand: unique symbol;

/**
 * A branded alias: exported and named, but its target is an intersection, and its printed
 * expansion mentions `brand` — a module-local `const` no import can bind.
 */
export type UserId = string & { readonly [brand]: "UserId" };

export type BrandedConsumer = {
  run: () => void;
};

type BrandedDeps = {
  userId: UserId;
};

export const buildBrandedConsumer = (_deps: BrandedDeps): BrandedConsumer => ({
  run: () => {},
});
