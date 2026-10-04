import { Result } from "@/utils/Result";

export type KubeLabels = Readonly<Record<string, string>>;
const segment = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,61}[A-Za-z0-9])?$/;
const dns = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
const validKey = (key: string): boolean => {
  const parts = key.split("/");
  if (parts.length === 1) return segment.test(key);
  const [prefix = "", name = ""] = parts;
  return (
    parts.length === 2 &&
    prefix.length <= 253 &&
    prefix.split(".").every((p) => dns.test(p)) &&
    segment.test(name)
  );
};

export const KubeLabels = {
  parse(value: unknown, required = false): Result<KubeLabels, string> {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return Result.err("Labels/selector must be a string map.");
    const entries = Object.entries(value);
    if (entries.length > 100 || (required && entries.length === 0))
      return Result.err("Use 1 to 100 selector labels (metadata labels may be empty).");
    if (
      entries.some(
        ([key, v]) => !validKey(key) || typeof v !== "string" || (v !== "" && !segment.test(v)),
      )
    )
      return Result.err("Invalid label key/value; quote numbers and booleans.");
    return Result.ok(
      Object.fromEntries(entries.toSorted(([a], [b]) => a.localeCompare(b))) as KubeLabels,
    );
  },
  query(value: string): Result<KubeLabels, string> {
    const entries = value.split(",").map((term) => term.trim().split(/==|=/));
    if (
      entries.some((parts) => parts.length !== 2) ||
      new Set(entries.map(([key]) => key?.trim())).size !== entries.length
    )
      return Result.err(
        "Use comma-separated key=value selectors; set/existence/inequality selectors are not supported.",
      );
    return KubeLabels.parse(
      Object.fromEntries(entries.map(([key, value]) => [key?.trim(), value?.trim()])),
      true,
    );
  },
  matches(selector: KubeLabels, labels: KubeLabels): boolean {
    return (
      Object.keys(selector).length > 0 &&
      Object.entries(selector).every(
        ([key, value]) => Object.hasOwn(labels, key) && labels[key] === value,
      )
    );
  },
  equal(a: KubeLabels, b: KubeLabels): boolean {
    return (
      Object.keys(a).length === Object.keys(b).length &&
      Object.entries(a).every(([key, value]) => Object.hasOwn(b, key) && b[key] === value)
    );
  },
  text(labels: KubeLabels): string {
    return (
      Object.entries(labels)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join(", ") || "<none>"
    );
  },
} as const;
