export type Logger = {
  log: (msg: string) => void;
};

export type Database = {
  query: (sql: string) => void;
};

export type UserService = {
  greet: () => string;
};

export type PostgresClient = {
  connect: () => void;
};

export type AlbumRepository = {
  findAll: () => string[];
};

export type AlbumService = {
  list: () => string[];
};
