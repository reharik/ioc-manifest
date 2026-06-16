import type { IocGeneratedCradle } from "./generated/ioc-registry.types.js";
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
