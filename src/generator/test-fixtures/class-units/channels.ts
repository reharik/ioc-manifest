import type { EmailChannel, SmsChannel } from "./contracts.js";

/** Class unit joining a collection group over `Channel`. */
export class EmailChannelUnit implements EmailChannel {
  readonly channelId = "email";
  readonly kind = "email" as const;
}

export const buildSmsChannel = (): SmsChannel => ({
  channelId: "sms",
  kind: "sms",
});
