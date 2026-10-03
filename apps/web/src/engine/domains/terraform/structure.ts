/** Names and paths belong to the in-memory Terraform workspace, never the host filesystem. */
const identifier = (name: string): boolean =>
  /^[A-Za-z_][A-Za-z0-9_-]*$/.test(name) &&
  !["__proto__", "prototype", "constructor"].includes(name);
export type TfMove = Readonly<{ from: string; to: string }>;
export const TfStructure = {
  identifier,
  filePath(path: string): boolean {
    const parts = path.split("/");
    return (
      path.length <= 300 &&
      parts.length <= 10 &&
      parts.every(
        (p) =>
          /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(p) &&
          !["__proto__", "prototype", "constructor"].includes(p),
      ) &&
      /\.(tf|tfvars)$/.test(path)
    );
  },
  modulePath(directory: string, source: string): string {
    if (!source.startsWith("./") && !source.startsWith("../"))
      throw new Error("Only local module sources starting with ./ or ../ are supported.");
    if (source.length > 300) throw new Error("Module source path is too long.");
    const parts = directory ? directory.split("/") : [];
    for (const part of source.split("/")) {
      if (part === ".") continue;
      if (part === "..") {
        if (!parts.length) throw new Error("Module source escapes the virtual workspace.");
        parts.pop();
        continue;
      }
      if (
        !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(part) ||
        ["__proto__", "prototype", "constructor"].includes(part)
      )
        throw new Error("Invalid local module source path.");
      parts.push(part);
    }
    return parts.join("/");
  },
  resourceType(address: string): string | undefined {
    const parts = address.split(".");
    if (parts.length < 2 || parts.length > 10 || parts.length % 2 !== 0 || !parts.every(identifier))
      return undefined;
    for (let i = 0; i < parts.length - 2; i += 2) if (parts[i] !== "module") return undefined;
    const type = parts.at(-2);
    return type === "google_compute_network" ||
      type === "google_compute_subnetwork" ||
      type === "google_compute_instance" ||
      type === "google_compute_firewall" ||
      type === "google_storage_bucket"
      ? type
      : undefined;
  },
  validateMoves(moves: readonly TfMove[]): void {
    if (moves.length > 100) throw new Error("At most 100 moved declarations are supported.");
    const froms = new Set<string>();
    const tos = new Set<string>();
    for (const move of moves) {
      const type = TfStructure.resourceType(move.from);
      if (!type || type !== TfStructure.resourceType(move.to) || move.from === move.to)
        throw new Error("moved requires different resource addresses of the same supported type.");
      if (froms.has(move.from) || tos.has(move.to))
        throw new Error("Ambiguous moved declarations: duplicate source or destination.");
      froms.add(move.from);
      tos.add(move.to);
    }
    for (const move of moves) TfStructure.destination(move.from, moves);
  },
  destination(address: string, moves: readonly TfMove[]): string {
    const visited = new Set<string>();
    let next = address;
    while (true) {
      if (visited.has(next)) throw new Error("Cycle in moved declarations.");
      visited.add(next);
      const move = moves.find((m) => m.from === next);
      if (!move) return next;
      next = move.to;
    }
  },
  remap<T extends { address: string }>(
    resources: readonly T[],
    moves: readonly TfMove[],
  ): readonly T[] {
    TfStructure.validateMoves(moves);
    const result = resources.map((r) => ({
      ...r,
      address: TfStructure.destination(r.address, moves),
    }));
    if (new Set(result.map((r) => r.address)).size !== result.length)
      throw new Error("Move destination already exists in state.");
    return result;
  },
} as const;
