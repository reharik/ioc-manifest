/** Empty marker — structural assignability incorrectly tags every factory. */
export interface IScoped {}

export interface ScopedService extends IScoped {
  readonly label: string;
}

export interface PlainService {
  readonly id: string;
}
