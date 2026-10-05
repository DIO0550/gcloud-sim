import { Result } from "@/utils/Result";

/** ConfigMap bytes stay as canonical base64; they are never decoded as text. */
export const KubeBinary = {
  parse(value: string): Result<string, string> {
    if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
      return Result.err("binaryData must contain valid base64.");

    try {
      return Result.ok(btoa(atob(value)));
    } catch {
      return Result.err("binaryData must contain valid base64.");
    }
  },

  /** Call only with validated base64. Padding is not part of the byte payload. */
  size(value: string): number {
    const size = (value.length / 4) * 3;
    if (value.endsWith("==")) return size - 2;
    if (value.endsWith("=")) return size - 1;
    return size;
  },
} as const;
