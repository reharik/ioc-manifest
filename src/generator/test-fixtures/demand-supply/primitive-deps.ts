import type { Database } from "./contracts.js";

type AuthServiceDeps = {
  viewerId: string;
  database: Database;
};

export const buildAuthService = ({
  viewerId,
  database,
}: AuthServiceDeps): { viewerId: string } => ({
  viewerId,
  database,
});
