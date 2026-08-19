/** Empty base — structural assignability matches every object type, so membership must be nominal. */
export interface RejectBase {}

export interface PrimaryMember extends RejectBase {
  p(): void;
}

/** Structurally assignable to the empty base, but declares no heritage to it. */
export interface StructuralSibling {
  s(): void;
}

export interface UnionPart extends RejectBase {
  u(): void;
}

/** A contract alias whose right-hand side is a union — never nominal heritage to the base. */
export type UnionContract = UnionPart | StructuralSibling;
