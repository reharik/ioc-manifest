import type {
  PrimaryMember,
  StructuralSibling,
  UnionContract,
} from "./contracts.js";

/**
 * Registers at the contract default-slot key (`primaryMember`). The config elects the other
 * implementation as default, so a collection group drops this one.
 */
export const buildPrimaryMember = (): PrimaryMember => ({ p: () => {} });

export const buildAltPrimaryMember = (): PrimaryMember => ({ p: () => {} });

export const buildStructuralSibling = (): StructuralSibling => ({
  s: () => {},
});

export const buildUnionContract = (): UnionContract => ({ s: () => {} });
