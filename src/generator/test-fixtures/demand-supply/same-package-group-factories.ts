import type { IocGeneratedCradle } from "./mock-ioc-generated-cradle-channels.js";
import type {
  EmailChannel,
  NotificationService,
  SmsChannel,
} from "./channel-contracts.js";

export const buildEmailChannel = (): EmailChannel => ({
  sendEmail: () => {},
});

export const buildSmsChannel = (): SmsChannel => ({
  sendSms: () => {},
});

type NotificationServiceDeps = {
  channels: IocGeneratedCradle["channels"];
};

export const buildNotificationService = ({
  channels,
}: NotificationServiceDeps): NotificationService => ({
  notifyAll: (to) => {
    channels.emailChannel.sendEmail(to);
    channels.smsChannel.sendSms(to);
  },
});

type LoggerViaCradleDeps = {
  channel: IocGeneratedCradle["channel"];
};

export const buildTypoCradleConsumer = ({
  channel,
}: LoggerViaCradleDeps): NotificationService => ({
  notifyAll: () => {
    channel;
  },
});
