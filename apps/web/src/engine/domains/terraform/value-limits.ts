import type { TfValue } from "./expressions";

type Weight = Readonly<{ nodes: number; bytes: number; depth: number }>;

// Memoize expanded weights, not visits: repeating a shared local still repeats its JSON payload.
// Check before materializing a tree so a small reference DAG cannot allocate exponential output.
export const checkTfValue = (value: TfValue): TfValue => {
  const memo = new WeakMap<object, Weight>();
  const weight = (v: TfValue, level: number): Weight => {
    if (level > 24) {
      throw new Error("Expression value depth limit exceeded.");
    }
    if (typeof v !== "object") {
      return { nodes: 1, bytes: JSON.stringify(v).length, depth: 0 };
    }
    const cached = memo.get(v);
    if (cached) {
      return cached;
    }
    const entries = v instanceof Set ? [...v].map((x) => ["", x] as const) : Object.entries(v);
    let nodes = 1;
    let bytes = 2;
    let depth = 0;
    for (const [key, child] of entries) {
      const next = weight(child, level + 1);
      nodes += next.nodes;
      bytes += next.bytes + key.length + 4;
      depth = Math.max(depth, next.depth + 1);
      if (nodes > 10000 || bytes > 64000 || depth > 24) {
        throw new Error(
          "Expression expanded value limit exceeded (10000 nodes / 64000 characters / depth 24).",
        );
      }
    }
    const result = { nodes, bytes, depth };
    memo.set(v, result);
    return result;
  };
  const result = weight(value, 0);
  if (result.bytes > 64000) {
    throw new Error("Expression string limit exceeded.");
  }
  return value;
};
