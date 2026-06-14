import type { ViewerReadService } from "../types/ViewerReadService.js";

type ViewerReadServiceDeps = {
  viewerId: string;
};

export const buildViewerReadService = ({
  viewerId,
}: ViewerReadServiceDeps): ViewerReadService => ({
  whoami: () => viewerId,
});
