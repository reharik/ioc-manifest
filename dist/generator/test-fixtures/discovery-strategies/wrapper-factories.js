import { injectable } from "../../../core/injectable.js";
export const makeWrapped = injectable(() => ({ x: "wrapped" }));
export const makeWrappedZero = injectable(() => ({ x: "zero" }));
export const makeWrappedWithDeps = injectable(({ dep }) => ({ x: dep }));
//# sourceMappingURL=wrapper-factories.js.map