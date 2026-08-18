/** Contracts and lifetime markers for the class-registration-unit fixtures. */

export interface Scoped {}

export type MediaStorage = {
  label: string;
  put: (key: string) => void;
};

export type Auditor = {
  audit: () => string;
};

/** Carries the `Scoped` lifetime marker through the class's `implements` clause. */
export interface RequestAuditor extends Auditor, Scoped {}

export type ApiClient = {
  call: () => string;
};

export type HttpsProxy = {
  forward: () => string;
};

/** Collection-group base. */
export type Channel = {
  readonly channelId: string;
};

export type EmailChannel = Channel & { readonly kind: "email" };
export type SmsChannel = Channel & { readonly kind: "sms" };
