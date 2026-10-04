import type { JsonRecord } from "@/types/Json";
import { Result } from "@/utils/Result";

export type ResourceName = "cpu" | "memory";
export type ResourceAmounts = Readonly<Partial<Record<ResourceName, string>>>;
export type KubeResources = Readonly<{ requests: ResourceAmounts; limits: ResourceAmounts }>;
const names = ["cpu", "memory"] as const;
const memoryUnits: Readonly<Record<string, bigint>> = {
  "": 1n,
  K: 1000n,
  M: 1000000n,
  G: 1000000000n,
  T: 1000000000000n,
  Ki: 1024n,
  Mi: 1048576n,
  Gi: 1073741824n,
  Ti: 1099511627776n,
};
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const cpuAmount = (text: string): Result<bigint, string> => {
  const milli = /^(\d+)m$/.exec(text);
  if (milli) return Result.ok(BigInt(milli[1] ?? "0"));
  const cores = /^(\d+)(?:\.(\d{1,3}))?$/.exec(text);
  if (!cores)
    return Result.err(
      "CPU supports nonnegative cores (up to 3 decimal places) or integer m units.",
    );
  return Result.ok(BigInt(cores[1] ?? "0") * 1000n + BigInt((cores[2] ?? "").padEnd(3, "0")));
};
const memoryAmount = (text: string): Result<bigint, string> => {
  const match = /^(\d+)(Ki|Mi|Gi|Ti|K|M|G|T)?$/.exec(text);
  if (!match)
    return Result.err(
      "Memory supports nonnegative integer bytes or Ki/Mi/Gi/Ti/K/M/G/T units on gcloud-sim.",
    );
  return Result.ok(BigInt(match[1] ?? "0") * (memoryUnits[match[2] ?? ""] ?? 1n));
};
const quantity = (
  name: ResourceName,
  input: unknown,
): Result<{ value: bigint; text: string }, string> => {
  if (typeof input !== "string" && typeof input !== "number")
    return Result.err(`${name} quantity must be a string or number.`);
  const text = String(input);
  if (text.length > 32) return Result.err(`${name} quantity is too large.`);
  const parsed = name === "cpu" ? cpuAmount(text) : memoryAmount(text);
  if (!Result.isOk(parsed)) return parsed;
  const value = parsed.value;
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    return Result.err(`${name} quantity exceeds the simulator's safe integer range.`);
  if (name === "cpu")
    return Result.ok({ value, text: value % 1000n === 0n ? String(value / 1000n) : `${value}m` });
  const unit = ["Ti", "Gi", "Mi", "Ki"].find(
    (unit) => value > 0n && value % (memoryUnits[unit] ?? 1n) === 0n,
  );
  return Result.ok({
    value,
    text: unit ? `${value / (memoryUnits[unit] ?? 1n)}${unit}` : String(value),
  });
};
const amounts = (input: unknown): Result<ResourceAmounts, string> => {
  if (!record(input) || Object.keys(input).some((key) => key !== "cpu" && key !== "memory"))
    return Result.err("Resources support only cpu and memory maps.");
  const output: Partial<Record<ResourceName, string>> = {};
  for (const name of names) {
    if (!Object.hasOwn(input, name)) continue;
    const parsed = quantity(name, input[name]);
    if (!Result.isOk(parsed)) return parsed;
    output[name] = parsed.value.text;
  }
  return Result.ok(output);
};

export const KubeResources = {
  /** Canonical request quantity in millicores; omitted requests have no utilization base. */
  cpuMilli(text: string | undefined): number {
    if (text === undefined) return 0;
    return Number(Result.unwrap(cpuAmount(text)));
  },
  empty(): KubeResources {
    return { requests: {}, limits: {} };
  },
  parse(input: unknown): Result<KubeResources, string> {
    if (!record(input) || Object.keys(input).some((key) => key !== "requests" && key !== "limits"))
      return Result.err("resources supports only requests and limits.");
    const limits = amounts(input.limits === undefined ? {} : input.limits);
    if (!Result.isOk(limits)) return limits;
    const requests = amounts(input.requests === undefined ? {} : input.requests);
    if (!Result.isOk(requests)) return requests;
    const defaulted = { ...requests.value };
    for (const name of names) {
      const limit = limits.value[name];
      if (limit === undefined) continue;
      const request = defaulted[name] ?? limit;
      if (Result.unwrap(quantity(name, request)).value > Result.unwrap(quantity(name, limit)).value)
        return Result.err(`${name} request must not exceed its limit.`);
      defaulted[name] = request;
    }
    return Result.ok({ requests: defaulted, limits: limits.value });
  },
  equal(a: KubeResources, b: KubeResources): boolean {
    return names.every(
      (name) => a.requests[name] === b.requests[name] && a.limits[name] === b.limits[name],
    );
  },
  /** CLI patches only named keys. A zero quantity removes that key, as in kubectl set resources. */
  patch(
    current: KubeResources,
    requests: string | undefined,
    limits: string | undefined,
  ): Result<KubeResources, string> {
    const next = { requests: { ...current.requests }, limits: { ...current.limits } };
    for (const [kind, text] of [
      ["requests", requests],
      ["limits", limits],
    ] as const) {
      if (text === undefined) continue;
      const entries = text.split(",").map((entry) => entry.split("="));
      if (
        entries.some((entry) => entry.length !== 2) ||
        new Set(entries.map(([key]) => key)).size !== entries.length
      )
        return Result.err("Use unique cpu=QUANTITY,memory=QUANTITY pairs.");
      const parsed = amounts(Object.fromEntries(entries.map(([key, value]) => [key, value])));
      if (!Result.isOk(parsed)) return parsed;
      for (const name of names) {
        const value = parsed.value[name];
        if (value === undefined) continue;
        if (value === "0") {
          delete next[kind][name];
          continue;
        }
        next[kind][name] = value;
      }
    }
    return KubeResources.parse(next);
  },
  toContainerFields(resources: KubeResources): JsonRecord {
    if (!Object.keys(resources.requests).length && !Object.keys(resources.limits).length) return {};
    return { resources: { requests: resources.requests, limits: resources.limits } };
  },
  text(amounts: ResourceAmounts): string {
    return (
      names
        .filter((name) => amounts[name] !== undefined)
        .map((name) => `${name}=${amounts[name]}`)
        .join(", ") || "未指定"
    );
  },
} as const;
