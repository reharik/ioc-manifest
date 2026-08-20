export interface MediaStorage {
  upload(name: string): string;
}

export interface UploadService {
  upload(name: string): string;
}

/** Root contract of the scope-root variant the opener fixtures declare. */
export interface ScopedStorage {
  upload(name: string): string;
}

/** Only ever referenced by the deliberately-stale generated fixture. */
export interface StaleContract {
  readonly stale: true;
}
