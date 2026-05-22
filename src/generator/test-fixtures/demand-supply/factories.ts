import type {
  AlbumRepository,
  AlbumService,
  Database,
  Logger,
  PostgresClient,
  UserService,
} from "./contracts.js";

type BuildUserServiceDeps = {
  database: Database;
  logger: Logger;
};

export const buildUserService = ({
  database,
  logger,
}: BuildUserServiceDeps): UserService => ({
  greet: () => {
    logger.log("hi");
    database.query("select 1");
    return "hello";
  },
});

type BuildUserServiceAltDeps = {
  database: PostgresClient;
  logger: Logger;
};

export const buildUserServiceAlt = ({
  database,
  logger,
}: BuildUserServiceAltDeps): UserService => ({
  greet: () => {
    logger.log("alt");
    database.connect();
    return "alt";
  },
});

export const buildAlbumRepository = (): AlbumRepository => ({
  findAll: () => ["a"],
});

type BuildAlbumServiceDeps = {
  albumRepository: AlbumRepository;
};

export const buildAlbumService = ({
  albumRepository,
}: BuildAlbumServiceDeps): AlbumService => ({
  list: () => albumRepository.findAll(),
});

export const buildOrphanSupply = (): Logger => ({
  log: () => {},
});
