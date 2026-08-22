/* AUTO-GENERATED. DO NOT EDIT.
Re-run `npm run gen:manifest` after changing factories or IoC config.
*/
import type { Logger } from "../examples/a-single-implementation.js";
import type { MediaStorage } from "../examples/b-multiple-implementations.js";
import type {
  Widget,
  WidgetInspector,
} from "../examples/c-default-selection.js";
import type {
  CacheClient,
  DispatchService,
  EmailChannel,
  SmsChannel,
} from "../examples/d-grouping.js";
import type { AlbumService } from "../examples/f-dependency-injection.js";
import type {
  ReportGateway,
  RequestReport,
  Viewer,
} from "../examples/h-scope-root.js";

export interface IocGeneratedCradle {
  albumService: AlbumService;
  archiveMediaStorage: MediaStorage;
  auditedMediaStorage: MediaStorage;
  cacheClient: CacheClient;
  consoleLogger: Logger;
  dispatchService: DispatchService;
  localMediaStorage: MediaStorage;
  logger: Logger;
  mediaStorage: MediaStorage;
  memoryCache: CacheClient;
  notificationChannels: {
    emailChannel: EmailChannel;
    smsChannel: SmsChannel;
  };
  openPublicReportScope: OpenPublicReportScope;
  openRequestReportScope: OpenRequestReportScope;
  primaryWidget: Widget;
  reportGateway: ReportGateway;
  s3MediaStorage: MediaStorage;
  secondaryWidget: Widget;
  widget: Widget;
  widgetInspector: WidgetInspector;
}

export type NotificationChannels = {
  emailChannel: EmailChannel;
  smsChannel: SmsChannel;
};

export type OpenPublicReportScope = () => {
  publicReport: RequestReport;
  dispose: () => Promise<void>;
};

export type OpenRequestReportScope = (lbv: { viewer: Viewer }) => {
  requestReport: RequestReport;
  dispose: () => Promise<void>;
};

export interface IocExternals {
  viewer: Viewer;
}

export interface IocScopeProvided {}
