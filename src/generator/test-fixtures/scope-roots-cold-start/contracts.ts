/** Contracts for the cold-start opener fixture. */

export interface IAuthService {
  authenticate: (token: string) => string;
}
