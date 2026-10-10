/** Bounded HCL syntax. Expressions are interpreted as data, never JavaScript. */
export type Expression =
  | string
  | number
  | boolean
  | Readonly<{ list: readonly Expression[] }>
  | Readonly<{ object: Readonly<Record<string, Expression>> }>
  | Readonly<{ ref: string }>
  | Readonly<{ call: string; args: readonly Expression[] }>
  | Readonly<{ index: Expression; key: Expression }>
  | Readonly<{ attribute: Expression; name: string }>
  | Readonly<{ template: readonly Expression[] }>
  | Readonly<{ unary: string; value: Expression }>
  | Readonly<{ operator: string; left: Expression; right: Expression }>
  | Readonly<{ condition: Expression; yes: Expression; no: Expression }>;
export type HclBody = Readonly<{
  attributes: Readonly<Record<string, Expression>>;
  blocks: readonly HclBlock[];
}>;
export type HclBlock = Readonly<{ type: string; labels: readonly string[]; body: HclBody }>;
const identifier = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const safeKey = (key: string): void => {
  if (["__proto__", "prototype", "constructor"].includes(key)) {
    throw new Error(`Unsupported identifier: ${key}`);
  }
};
const precedence: Readonly<Record<string, number>> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
};
export const Hcl = {
  parse(source: string): HclBody {
    if (source.length > 64000) {
      throw new Error("HCL file exceeds 64,000 characters.");
    }
    const tokens: string[] = [];
    let offset = 0;
    const pattern =
      /\s+|#[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*|==|!=|<=|>=|&&|\|\||[{}=,[\]().?:+*/%!<>-]/y;
    while (offset < source.length) {
      pattern.lastIndex = offset;
      const found = pattern.exec(source);
      if (!found) {
        throw new Error(`Unsupported HCL syntax near: ${source.slice(offset, offset + 40)}`);
      }
      const token = found[0];
      if (!/^\s|^#|^\/\//.test(token) && !token.startsWith("/*")) {
        tokens.push(token);
      }
      offset = pattern.lastIndex;
    }
    let cursor = 0;
    const take = (): string => {
      const token = tokens[cursor++];
      if (token === undefined) {
        throw new Error("Unexpected end of HCL.");
      }
      return token;
    };
    const expect = (token: string): void => {
      if (take() !== token) {
        throw new Error(`Expected '${token}' in HCL.`);
      }
    };
    const quoted = (token: string): string => JSON.parse(token) as string;
    const atom = (depth: number): Expression => {
      if (depth > 12) {
        throw new Error("HCL nesting limit exceeded.");
      }
      const token = take();
      if (token.startsWith('"')) {
        const value = quoted(token);
        if (value.includes("%{") || value.includes("$${")) {
          throw new Error("Template directives and escapes are not supported.");
        }
        if (!value.includes("${")) {
          return value;
        }
        const parts: Expression[] = [];
        let end = 0;
        for (const match of value.matchAll(/\$\{([^{}]*)\}/g)) {
          parts.push(value.slice(end, match.index));
          const parsed = Hcl.parse(`value = ${match[1]}`);
          const inner = parsed.attributes.value;
          if (
            inner === undefined ||
            parsed.blocks.length ||
            Object.keys(parsed.attributes).length !== 1
          ) {
            throw new Error("Invalid template expression.");
          }
          parts.push({ call: "tostring", args: [inner] });
          end = match.index + match[0].length;
        }
        parts.push(value.slice(end));
        if (parts.some((part) => typeof part === "string" && part.includes("${"))) {
          throw new Error("Nested or unclosed template expression.");
        }
        return { template: parts };
      }
      if (token === "true" || token === "false") {
        return token === "true";
      }
      if (/^\d/.test(token)) {
        const value = Number(token);
        if (!Number.isFinite(value)) {
          throw new Error("Non-finite HCL number.");
        }
        return value;
      }
      if (token === "!" || token === "-") {
        return { unary: token, value: expression(depth + 1, 7) };
      }
      if (token === "(") {
        const value = expression(depth + 1);
        expect(")");
        return value;
      }
      if (token === "[") {
        const list: Expression[] = [];
        while (tokens[cursor] !== "]") {
          if (list.length >= 100) {
            throw new Error("At most 100 list entries are supported.");
          }
          list.push(expression(depth + 1));
          if (tokens[cursor] === "]") {
            break;
          }
          expect(",");
        }
        expect("]");
        return { list };
      }
      if (token === "{") {
        const object: Record<string, Expression> = {};
        while (tokens[cursor] !== "}") {
          if (Object.keys(object).length >= 100) {
            throw new Error("At most 100 object entries are supported.");
          }
          const raw = take();
          const key = raw.startsWith('"') ? quoted(raw) : raw;
          safeKey(key);
          if (Object.hasOwn(object, key)) {
            throw new Error(`Duplicate attribute: ${key}`);
          }
          expect("=");
          object[key] = expression(depth + 1);
          if (tokens[cursor] === ",") {
            cursor++;
          }
        }
        expect("}");
        return { object };
      }
      if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(token)) {
        for (const part of token.split(".")) {
          safeKey(part);
        }
        if (tokens[cursor] !== "(") {
          return { ref: token };
        }
        cursor++;
        const args: Expression[] = [];
        while (tokens[cursor] !== ")") {
          if (args.length >= 100) {
            throw new Error("Function argument limit exceeded.");
          }
          args.push(expression(depth + 1));
          if (tokens[cursor] === ")") {
            break;
          }
          expect(",");
        }
        expect(")");
        return { call: token, args };
      }
      throw new Error(`Unsupported expression: ${token}`);
    };
    const expression = (depth: number, minimum = 0): Expression => {
      let left = atom(depth);
      while (true) {
        const token = tokens[cursor] ?? "";
        if (token === "[") {
          cursor++;
          left = { index: left, key: expression(depth + 1) };
          expect("]");
          continue;
        }
        if (token === ".") {
          cursor++;
          for (const name of take().split(".")) {
            safeKey(name);
            if (!identifier.test(name)) {
              throw new Error("Invalid attribute traversal.");
            }
            left = { attribute: left, name };
          }
          continue;
        }
        const rank = precedence[token];
        if (rank === undefined || rank < minimum) {
          break;
        }
        cursor++;
        left = { operator: token, left, right: expression(depth + 1, rank + 1) };
      }
      if (minimum === 0 && tokens[cursor] === "?") {
        cursor++;
        const yes = expression(depth + 1);
        expect(":");
        return { condition: left, yes, no: expression(depth + 1) };
      }
      return left;
    };
    const body = (nested: boolean, depth: number): HclBody => {
      if (depth > 12) {
        throw new Error("HCL nesting limit exceeded.");
      }
      const attributes: Record<string, Expression> = {};
      const blocks: HclBlock[] = [];
      while (cursor < tokens.length && tokens[cursor] !== "}") {
        const key = take();
        safeKey(key);
        if (!identifier.test(key)) {
          throw new Error(`Expected identifier: ${key}`);
        }
        if (tokens[cursor] === "=") {
          cursor++;
          if (Object.hasOwn(attributes, key)) {
            throw new Error(`Duplicate attribute: ${key}`);
          }
          attributes[key] = expression(depth + 1);
          continue;
        }
        const labels: string[] = [];
        while (tokens[cursor]?.startsWith('"')) {
          labels.push(quoted(take()));
        }
        expect("{");
        blocks.push({ type: key, labels, body: body(true, depth + 1) });
      }
      if (nested) {
        expect("}");
      }
      if (!nested && cursor !== tokens.length) {
        throw new Error("Unexpected closing brace.");
      }
      return { attributes, blocks };
    };
    return body(false, 0);
  },
  expression(source: string): Expression {
    const body = Hcl.parse(`value = ${source}`);
    const value = body.attributes.value;
    if (value === undefined || body.blocks.length || Object.keys(body.attributes).length !== 1) {
      throw new Error("Expected exactly one HCL expression.");
    }
    return value;
  },
  address(expr: Expression): string {
    if (typeof expr !== "object") {
      throw new Error("Expected an unquoted address.");
    }
    if ("ref" in expr) {
      return expr.ref;
    }
    if ("attribute" in expr) {
      return `${Hcl.address(expr.attribute)}.${expr.name}`;
    }
    if ("index" in expr && (typeof expr.key === "string" || typeof expr.key === "number")) {
      return `${Hcl.address(expr.index)}[${JSON.stringify(expr.key)}]`;
    }
    throw new Error("Address indices must be literal strings or integers.");
  },
  formatExpression(e: Expression): string {
    const format = Hcl.formatExpression;
    if (typeof e !== "object") {
      return JSON.stringify(e);
    }
    if ("ref" in e) {
      return e.ref;
    }
    if ("list" in e) {
      return `[${e.list.map(format).join(", ")}]`;
    }
    if ("object" in e) {
      return `{ ${Object.entries(e.object)
        .map(([k, v]) => `${JSON.stringify(k)} = ${format(v)}`)
        .join(", ")} }`;
    }
    if ("call" in e) {
      return `${e.call}(${e.args.map(format).join(", ")})`;
    }
    if ("index" in e) {
      return `${format(e.index)}[${format(e.key)}]`;
    }
    if ("attribute" in e) {
      return `${format(e.attribute)}.${e.name}`;
    }
    if ("unary" in e) {
      return `(${e.unary}${format(e.value)})`;
    }
    if ("operator" in e) {
      return `(${format(e.left)} ${e.operator} ${format(e.right)})`;
    }
    if ("condition" in e) {
      return `(${format(e.condition)} ? ${format(e.yes)} : ${format(e.no)})`;
    }
    return JSON.stringify(
      e.template
        .map((part) => {
          if (typeof part === "string") {
            return part;
          }
          if (typeof part === "object" && "call" in part && part.call === "tostring") {
            return `\u0024{${format(part.args[0] ?? "")}}`;
          }
          return `\u0024{${format(part)}}`;
        })
        .join(""),
    );
  },
  format(body: HclBody, depth = 0): string {
    const pad = "  ".repeat(depth);
    const attrs = Object.entries(body.attributes).map(
      ([key, value]) => `${pad}${key} = ${Hcl.formatExpression(value)}\n`,
    );
    const blocks = body.blocks.map(
      (block) =>
        `${pad}${block.type}${block.labels.map((label) => ` ${JSON.stringify(label)}`).join("")} {\n${Hcl.format(block.body, depth + 1)}${pad}}\n`,
    );
    return [...attrs, ...blocks].join("");
  },
} as const;
