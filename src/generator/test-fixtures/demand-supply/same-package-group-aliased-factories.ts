import type { IocGeneratedCradle as Cradle } from "./mock-ioc-generated-cradle-channels.js";
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
  channels: Cradle["channels"];
};

export const buildNotificationService = ({
  channels,
}: NotificationServiceDeps): NotificationService => ({
  notifyAll: (to) => {
    channels.emailChannel.sendEmail(to);
    channels.smsChannel.sendSms(to);
  },
});

type TypoChannelDeps = {
  channel: Cradle["channel"];
};

export const buildTypoCradleConsumer = ({
  channel,
}: TypoChannelDeps): NotificationService => ({
  notifyAll: () => {
    channel;
  },
});
