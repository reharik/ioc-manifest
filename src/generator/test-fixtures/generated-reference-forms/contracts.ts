export interface MediaStorage {
  upload(name: string): string;
}

export interface UploadService {
  upload(name: string): string;
}

/** Only ever referenced by the deliberately-stale generated fixture. */
export interface StaleContract {
  readonly stale: true;
}
