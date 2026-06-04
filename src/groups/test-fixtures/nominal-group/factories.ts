import type { InGroupA, InGroupB, NotInGroup } from "./contracts.js";

export const buildInGroupA = (): InGroupA => ({
  a: () => {},
});

export const buildInGroupB = (): InGroupB => ({
  b: () => {},
});

export const buildNotInGroup = (): NotInGroup => ({
  n: () => {},
});
