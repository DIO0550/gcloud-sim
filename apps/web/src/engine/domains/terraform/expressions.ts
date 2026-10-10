import type { Expression, HclBody } from "@/engine/domains/terraform/hcl";
import { checkTfValue } from "./value-limits";
export type TfValue =
  | string
  | number
  | boolean
  | readonly TfValue[]
  | { readonly [key: string]: TfValue }
  | ReadonlySet<string>;
export type TfEvaluate = (expr: Expression) => TfValue;
const fail = (message: string): never => {
  throw new Error(message);
};
const scalar = (v: TfValue): string | number | boolean => {
  if (typeof v === "object") {
    return fail("Expected a scalar value.");
  }
  return v;
};
const text = (v: TfValue): string => {
  if (typeof v !== "string") {
    return fail("Expected a string.");
  }
  return v;
};
const numeric = (v: TfValue): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return fail("Expected a finite number.");
  }
  return v;
};
const truth = (v: TfValue): boolean => {
  if (typeof v !== "boolean") {
    return fail("Expected a boolean.");
  }
  return v;
};
const list = (v: TfValue): readonly TfValue[] => {
  if (v instanceof Set) {
    return [...v].sort();
  }
  if (!Array.isArray(v)) {
    return fail("Expected a list or set.");
  }
  return v;
};
const object = (v: TfValue): Readonly<Record<string, TfValue>> => {
  if (typeof v !== "object" || Array.isArray(v) || v instanceof Set) {
    return fail("Expected a map.");
  }
  return v as Readonly<Record<string, TfValue>>;
};
const at = (v: TfValue, key: TfValue): TfValue => {
  if (Array.isArray(v)) {
    if (typeof key !== "number" || !Number.isSafeInteger(key) || key < 0 || key >= v.length) {
      return fail("Invalid list index.");
    }
    return v[key] as TfValue;
  }
  const map = object(v);
  const name = text(key);
  if (!Object.hasOwn(map, name)) {
    return fail(`Unknown attribute or key: ${name}`);
  }
  return map[name] as TfValue;
};
const jsonTree = (v: TfValue): unknown => {
  if (v instanceof Set) {
    return [...v].sort();
  }
  if (Array.isArray(v)) {
    return v.map(jsonTree);
  }
  if (typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, jsonTree(x)]),
    );
  }
  return v;
};
const json = (v: TfValue): unknown => jsonTree(checkTfValue(v));
const joinText = (parts: readonly string[], separator: string): string => {
  let size = Math.max(0, parts.length - 1) * separator.length;
  for (const part of parts) {
    size += part.length;
    if (size > 64000) {
      fail("Expression string limit exceeded.");
    }
  }
  return parts.join(separator);
};
const call = (name: string, args: readonly TfValue[]): TfValue => {
  const arity = (minimum: number, maximum = minimum): void => {
    if (args.length < minimum || args.length > maximum) {
      fail(`Invalid argument count for ${name}.`);
    }
  };
  const arg = (index: number): TfValue => args[index] ?? fail(`Missing argument for ${name}.`);
  switch (name) {
    case "tostring":
      arity(1);
      return String(scalar(arg(0)));
    case "tonumber": {
      arity(1);
      const value = arg(0);
      if (typeof value !== "number" && typeof value !== "string") {
        return fail("tonumber requires a number or numeric string.");
      }
      if (typeof value === "string" && !/^-?\d+(\.\d+)?$/.test(value)) {
        return fail("Invalid numeric string.");
      }
      return numeric(Number(value));
    }
    case "lower":
      arity(1);
      return text(arg(0)).toLowerCase();
    case "upper":
      arity(1);
      return text(arg(0)).toUpperCase();
    case "length": {
      arity(1);
      const value = arg(0);
      if (typeof value === "string" || Array.isArray(value)) {
        return value.length;
      }
      if (value instanceof Set) {
        return value.size;
      }
      return Object.keys(object(value)).length;
    }
    case "toset":
      arity(1);
      return new Set(list(arg(0)).map(text));
    case "tolist":
      arity(1);
      return list(arg(0));
    case "keys":
      arity(1);
      return Object.keys(object(arg(0))).sort();
    case "values":
      arity(1);
      return Object.entries(object(arg(0)))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, v]) => v);
    case "join":
      arity(2);
      return joinText(list(arg(1)).map(text), text(arg(0)));
    case "concat":
      arity(1, 100);
      return args.flatMap((v) => list(v));
    case "merge":
      arity(1, 100);
      return Object.assign({}, ...args.map(object));
    case "contains":
      arity(2);
      return list(arg(0)).some((v) => JSON.stringify(json(v)) === JSON.stringify(json(arg(1))));
    case "lookup": {
      arity(2, 3);
      const map = object(arg(0));
      const key = text(arg(1));
      if (Object.hasOwn(map, key)) {
        return map[key] as TfValue;
      }
      if (args.length === 3) {
        return arg(2);
      }
      return fail(`Unknown lookup key: ${key}`);
    }
    case "format": {
      arity(1, 100);
      let index = 1;
      const result = text(arg(0)).replace(/%(%|s|d)/g, (_, spec: string) => {
        if (spec === "%") {
          return "%";
        }
        const value = arg(index++);
        if (spec === "d") {
          if (!Number.isSafeInteger(numeric(value))) {
            return fail("%d requires an integer.");
          }
          return String(value);
        }
        return String(scalar(value));
      });
      if (index !== args.length || /%(?!%)/.test(text(arg(0)).replace(/%(?:%|s|d)/g, ""))) {
        return fail("Unsupported format pattern or argument count.");
      }
      return result;
    }
    default:
      return fail(`Unsupported function: ${name}. No host files or code are evaluated.`);
  }
};
const binary = (operator: string, a: TfValue, b: TfValue): TfValue => {
  if (operator === "==") {
    return JSON.stringify(json(a)) === JSON.stringify(json(b));
  }
  if (operator === "!=") {
    return JSON.stringify(json(a)) !== JSON.stringify(json(b));
  }
  const left = numeric(a);
  const right = numeric(b);
  switch (operator) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      return left / right;
    case "%":
      return left % right;
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    default:
      return fail(`Unsupported operator: ${operator}`);
  }
};
export const TfExpressions = {
  scalar,
  object,
  list,
  at,
  json,
  evaluate(expr: Expression, resolve: (ref: string) => TfValue, depth = 0): TfValue {
    if (depth > 24) {
      return fail("Expression evaluation depth exceeded.");
    }
    if (typeof expr !== "object") {
      return checkTfValue(expr);
    }
    const evaluate = (value: Expression): TfValue =>
      TfExpressions.evaluate(value, resolve, depth + 1);
    let value: TfValue;
    if ("ref" in expr) {
      value = resolve(expr.ref);
    } else if ("list" in expr) {
      value = expr.list.map(evaluate);
    } else if ("object" in expr) {
      value = Object.fromEntries(Object.entries(expr.object).map(([key, v]) => [key, evaluate(v)]));
    } else if ("call" in expr) {
      value = call(expr.call, expr.args.map(evaluate));
    } else if ("index" in expr) {
      value = at(evaluate(expr.index), evaluate(expr.key));
    } else if ("attribute" in expr) {
      value = at(evaluate(expr.attribute), expr.name);
    } else if ("template" in expr) {
      value = joinText(
        expr.template.map((v) => String(scalar(evaluate(v)))),
        "",
      );
    } else if ("unary" in expr) {
      if (expr.unary === "!") {
        return !truth(evaluate(expr.value));
      }
      value = -numeric(evaluate(expr.value));
    } else if ("condition" in expr) {
      value = evaluate(truth(evaluate(expr.condition)) ? expr.yes : expr.no);
    } else if (expr.operator === "&&") {
      value = truth(evaluate(expr.left)) && truth(evaluate(expr.right));
    } else if (expr.operator === "||") {
      value = truth(evaluate(expr.left)) || truth(evaluate(expr.right));
    } else {
      value = binary(expr.operator, evaluate(expr.left), evaluate(expr.right));
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      return fail("Non-finite expression result.");
    }
    if (typeof value === "string" && value.length > 64000) {
      return fail("Expression string limit exceeded.");
    }
    if (Array.isArray(value) && value.length > 100) {
      return fail("Expression collection limit exceeded.");
    }
    if (typeof value === "object" && !(value instanceof Set) && Object.keys(value).length > 100) {
      return fail("Expression map limit exceeded.");
    }
    return checkTfValue(value);
  },
  literal(value: TfValue): Expression {
    checkTfValue(value);
    if (typeof value !== "object") {
      return value;
    }
    if (value instanceof Set) {
      return { list: [...value].sort() };
    }
    if (Array.isArray(value)) {
      return { list: value.map(TfExpressions.literal) };
    }
    return {
      object: Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, TfExpressions.literal(v)]),
      ),
    };
  },
  materialize(body: HclBody, evaluate: TfEvaluate, omit: readonly string[] = []): HclBody {
    return {
      attributes: Object.fromEntries(
        Object.entries(body.attributes)
          .filter(([k]) => !omit.includes(k))
          .map(([k, v]) => [k, TfExpressions.literal(evaluate(v))]),
      ),
      blocks: body.blocks.map((block) => ({
        ...block,
        body: TfExpressions.materialize(block.body, evaluate),
      })),
    };
  },
} as const;
