export type EmailChannel = {
  sendEmail: (to: string) => void;
};

export type SmsChannel = {
  sendSms: (to: string) => void;
};

export type NotificationService = {
  notifyAll: (to: string) => void;
};

export type Logger = {
  log: (msg: string) => void;
};
