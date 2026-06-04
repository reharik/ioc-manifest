/** Empty base — structural assignability incorrectly matches every object type. */
export interface BaseA {}

export interface InGroupA extends BaseA {
  a(): void;
}

export interface InGroupB extends BaseA {
  b(): void;
}

export interface NotInGroup {
  n(): void;
}
