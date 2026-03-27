import type { Foo } from "./contract.js";
export declare const makeWrapped: () => Foo;
export declare const makeWrappedZero: () => Foo;
export type Deps = {
    dep: string;
};
export declare const makeWrappedWithDeps: ({ dep }: Deps) => Foo;
//# sourceMappingURL=wrapper-factories.d.ts.map