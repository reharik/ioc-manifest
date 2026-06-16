import type { AlbumRepository } from "./contracts.js";
import type { IocGeneratedCradle } from "./mock-ioc-generated-cradle-channels.js";

type AlbumServiceViaCradleDeps = {
  albumRepository: IocGeneratedCradle["albumRepository"];
};

export const buildAlbumServiceViaCradle = ({
  albumRepository,
}: AlbumServiceViaCradleDeps): { list: () => string[] } => ({
  list: () => albumRepository.findAll(),
});
