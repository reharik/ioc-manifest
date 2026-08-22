import type { EmailStrategy, SmsStrategy } from "./contracts.js";

/** Shape-1 members: distinct contracts, ONE implementation each — and still slotless. */
export const buildEmailStrategy = (): EmailStrategy => ({
  medium: "email",
  notify: (message: string) => `email:${message}`,
});

export const buildSmsStrategy = (): SmsStrategy => ({
  medium: "sms",
  notify: (message: string) => `sms:${message}`,
});
