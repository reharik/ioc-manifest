export interface SweepTask {
  run: () => void;
}

export interface SweepReport {
  total: number;
}

/** Member of a group whose alias is NOT imported anywhere (regression control). */
export interface WorkerTask {
  work: () => void;
}
