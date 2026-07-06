export interface EmailChannel {
  sendEmail(to: string): void;
}

export interface SweepTask {
  run(): void;
}

export interface NotificationService {
  notifyAll(to: string): void;
}

export interface SweepReport {
  total: number;
}
