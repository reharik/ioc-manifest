export interface DupContract {
  a: string;
}

export const buildDupB = (): DupContract => ({ a: "b" });
