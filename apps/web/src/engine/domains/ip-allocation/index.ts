/** 教材用IP。通し番号から決定し、実ネットワークのアドレス取得は行わない。 */
const fromPrefix = (prefix: string, sequence: number, thirdOctet = (sequence >> 8) % 256): string =>
  `${prefix}.${thirdOctet}.${sequence % 256}`;

export const IpAllocation = {
  external: (sequence: number): string => fromPrefix("34.84", sequence),
  cluster: (sequence: number): string => fromPrefix("10.20", sequence),
  loadBalancer: (sequence: number): string => fromPrefix("34.85", sequence),
  frontend: (sequence: number): string =>
    fromPrefix("34.110", sequence, Math.floor(sequence / 256) % 256),
  sql: (sequence: number): string => fromPrefix("35.243", sequence),

  pod(slot: number, index: number): string {
    const host = index + 2;
    return `10.${Math.floor(slot / 64)}.${(slot % 64) * 4 + Math.floor(host / 256)}.${host % 256}`;
  },

  reserved(sequence: number, type: "INTERNAL" | "EXTERNAL", global: boolean): string {
    if (type === "INTERNAL") {
      return `10.146.15.${200 + (sequence % 50)}`;
    }
    return fromPrefix(global ? "34.120" : "35.200", sequence);
  },

  /** 保存済みIPを変えないため、サブネットの従来の教材採番規則を保つ。 */
  subnet(cidr: string, index: number): string {
    const octets = cidr.split("/")[0]?.split(".").map(Number) ?? [];
    const host = 2 + index;
    return `${octets[0] ?? 0}.${octets[1] ?? 0}.${(octets[2] ?? 0) + Math.floor(host / 256)}.${host % 256}`;
  },
} as const;
