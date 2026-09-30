/** 開発者向けのログ（E-015 など）。`console` に触るのはここだけ。 */
export const Logger = {
  error(message: string, detail: unknown): void {
    console.error(`[gcloud-sim] ${message}`, detail);
  },
} as const;
