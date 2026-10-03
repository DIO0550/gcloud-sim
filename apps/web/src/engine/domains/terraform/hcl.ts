/** A deliberately small HCL grammar. Expressions are data, never JavaScript. */
export type Expression =
  | string
  | number
  | boolean
  | Readonly<{ ref: string }>
  | Readonly<{ object: Readonly<Record<string, Expression>> }>;
export type HclBody = Readonly<{
  attributes: Readonly<Record<string, Expression>>;
  blocks: readonly HclBlock[];
}>;
export type HclBlock = Readonly<{ type: string; labels: readonly string[]; body: HclBody }>;

const identifier = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const safeKey = (key: string): void => {
  if (["__proto__", "prototype", "constructor"].includes(key))
    throw new Error(`Unsupported identifier: ${key}`);
};

export const Hcl = {
  parse(source: string): HclBody {
    if (source.length > 64000) throw new Error("HCL file exceeds 64,000 characters.");
    const tokens: string[] = [];
    let offset = 0;
    const pattern =
      /\s+|#[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*|[{}=,]/y;
    while (offset < source.length) {
      pattern.lastIndex = offset;
      const found = pattern.exec(source);
      if (!found)
        throw new Error(`Unsupported HCL syntax near: ${source.slice(offset, offset + 40)}`);
      const token = found[0];
      if (!/^\s|^#|^\/\//.test(token) && !token.startsWith("/*")) tokens.push(token);
      offset = pattern.lastIndex;
    }
    let cursor = 0;
    const take = (): string => {
      const token = tokens[cursor++];
      if (token === undefined) throw new Error("Unexpected end of HCL.");
      return token;
    };
    const quoted = (token: string): string => {
      const value: unknown = JSON.parse(token);
      if (typeof value !== "string" || /\$\{|%\{/.test(value))
        throw new Error("String templates are not supported yet.");
      return value;
    };
    const expression = (depth: number): Expression => {
      if (depth > 12) throw new Error("HCL nesting limit exceeded.");
      const token = take();
      if (token.startsWith('"')) return quoted(token);
      if (token === "true" || token === "false") return token === "true";
      if (/^-?\d/.test(token)) return Number(token);
      if (token === "{") {
        const object: Record<string, Expression> = {};
        while (tokens[cursor] !== "}") {
          const raw = take();
          const key = raw.startsWith('"') ? quoted(raw) : raw;
          safeKey(key);
          if (Object.hasOwn(object, key)) throw new Error(`Duplicate attribute: ${key}`);
          if (take() !== "=") throw new Error("Expected '=' in object.");
          object[key] = expression(depth + 1);
          if (tokens[cursor] === ",") cursor++;
        }
        cursor++;
        return { object };
      }
      if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(token)) return { ref: token };
      throw new Error(`Unsupported expression: ${token}`);
    };
    const body = (nested: boolean, depth: number): HclBody => {
      if (depth > 12) throw new Error("HCL nesting limit exceeded.");
      const attributes: Record<string, Expression> = {};
      const blocks: HclBlock[] = [];
      while (cursor < tokens.length && tokens[cursor] !== "}") {
        const key = take();
        safeKey(key);
        if (!identifier.test(key)) throw new Error(`Expected identifier: ${key}`);
        if (tokens[cursor] === "=") {
          cursor++;
          if (Object.hasOwn(attributes, key)) throw new Error(`Duplicate attribute: ${key}`);
          attributes[key] = expression(depth + 1);
          continue;
        }
        const labels: string[] = [];
        while (tokens[cursor]?.startsWith('"')) labels.push(quoted(take()));
        if (take() !== "{") throw new Error(`Expected block body: ${key}`);
        blocks.push({ type: key, labels, body: body(true, depth + 1) });
      }
      if (nested && take() !== "}") throw new Error("Expected closing brace.");
      if (!nested && cursor !== tokens.length) throw new Error("Unexpected closing brace.");
      return { attributes, blocks };
    };
    return body(false, 0);
  },

  format(body: HclBody, depth = 0): string {
    const pad = "  ".repeat(depth);
    const formatExpr = (e: Expression): string => {
      if (typeof e !== "object") return JSON.stringify(e);
      if ("ref" in e) return e.ref;
      return `{ ${Object.entries(e.object)
        .map(([k, v]) => `${k} = ${formatExpr(v)}`)
        .join(", ")} }`;
    };
    const attrs = Object.entries(body.attributes).map(
      ([key, value]) => `${pad}${key} = ${formatExpr(value)}\n`,
    );
    const blocks = body.blocks.map(
      (block) =>
        `${pad}${block.type}${block.labels.map((label) => ` ${JSON.stringify(label)}`).join("")} {\n${Hcl.format(block.body, depth + 1)}${pad}}\n`,
    );
    return [...attrs, ...blocks].join("");
  },
} as const;
