export interface DupContract {
  a: string;
}

export const buildDupA = (): DupContract => ({ a: "a" });
