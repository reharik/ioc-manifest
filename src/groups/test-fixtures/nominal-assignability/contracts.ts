export interface MarkerBase {}

export interface Mid extends MarkerBase {
  mid(): void;
}

export interface Deep extends Mid {
  deep(): void;
}

export interface Leaf extends MarkerBase {
  leaf(): void;
}

export interface ViaIntersectionMember {
  x(): void;
}

export type ViaIntersection = ViaIntersectionMember & MarkerBase;

export interface ViaUnionMember {
  u(): void;
}

export type ViaUnion = ViaUnionMember | MarkerBase;
