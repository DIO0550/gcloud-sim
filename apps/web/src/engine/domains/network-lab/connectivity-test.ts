import { ExternalIp, type Instance } from "@/engine/domains/compute";
import { Ipv4 } from "@/engine/domains/gke-control-plane";
import {
  type Check,
  type Decision,
  evaluateConnection,
  firewallDecision,
  natFor,
} from "@/engine/domains/network-lab/model";
import type { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";

/**
 * Network Intelligence Center の接続テスト（`gcloud network-management connectivity-tests`）。
 * パケットは送らず、構成（VM の状態・ルート・ファイアウォール）から到達できるかを判定する。
 */
export type ConnectivityProtocol = "TCP" | "UDP" | "ICMP";
export type ConnectivityResult = "REACHABLE" | "UNREACHABLE";

export type ConnectivityTest = Readonly<{
  projectId: string;
  name: string;
  sourceZone: string;
  sourceInstance: string;
  /** 宛先 VM の名前（`--destination-instance`）か、IP アドレス（`--destination-ip-address`） */
  destinationKind: "instance" | "ip";
  destination: string;
  destinationZone: string;
  protocol: ConnectivityProtocol;
  port: number;
  result: ConnectivityResult;
  /** 届かないときの理由（本物の DropInfo / AbortInfo の cause に寄せた綴り）。届けば空 */
  cause: string;
  /** 判定に効いたファイアウォール ルール（無ければ空） */
  rule: string;
  verifyTime: string;
}>;

export type ConnectivitySpec = Omit<ConnectivityTest, "result" | "cause" | "rule" | "verifyTime">;

/** 宛先の IP アドレスを持つ VM（内部 IP か外部 IP）。 */
const vmWithIp = (
  w: World,
  projectId: string,
  ip: string,
  kind: "internal" | "external",
): Instance | undefined =>
  w.instances.find(
    (i) =>
      i.projectId === projectId &&
      i.networkInterfaces.some((n) =>
        kind === "internal"
          ? n.networkIP === ip
          : Option.unwrapOr(ExternalIp.address(n.externalIP), "") === ip,
      ),
  );

const causeOf = (decision: Decision): string => {
  const reason = decision.reason;
  if (
    reason.startsWith("firewall:") ||
    reason.startsWith("policy:") ||
    reason === "implied-deny" ||
    reason === "implied-allow"
  ) {
    return "FIREWALL_RULE";
  }
  if (reason === "source-not-running" || reason === "destination-not-running") {
    return "INSTANCE_NOT_RUNNING";
  }
  if (reason === "no-external-ip-nat-or-pga") {
    return "NO_EXTERNAL_ADDRESS";
  }
  if (reason === "destination-not-found") {
    return "UNKNOWN_IP";
  }
  return "NO_ROUTE";
};

/**
 * 外部 IP 宛て。インターネット経由なので VPC が違っても届く（暗黙のデフォルト ルートを使う）。
 * 送信元に外部 IP か Cloud NAT が要り、宛先 VM の上りファイアウォールが送信元の外部 IP を許す必要がある。
 */
const viaExternalIp = (w: World, source: Instance, target: Instance, spec: ConnectivitySpec) => {
  const protocol = spec.protocol.toLowerCase();
  if (source.status !== "RUNNING" || target.status !== "RUNNING") {
    return { allowed: false, reason: "destination-not-running", rule: "", logging: false };
  }
  const sourceExternal = source.networkInterfaces
    .map((n) => ExternalIp.address(n.externalIP))
    .find(Option.isSome);
  if (sourceExternal === undefined && natFor(w, source) === undefined) {
    return { allowed: false, reason: "no-external-ip-nat-or-pga", rule: "", logging: false };
  }
  const origin = sourceExternal === undefined ? "203.0.113.20" : sourceExternal.value;
  const egress = firewallDecision(w, source, "EGRESS", spec.destination, protocol, spec.port);
  if (!egress.allowed) {
    return egress;
  }
  return firewallDecision(w, target, "INGRESS", origin, protocol, spec.port);
};

/**
 * 構成から到達性を判定する。
 *
 * @param w 判定する World
 * @param spec テストの送信元・宛先・プロトコル
 * @param now 判定した時刻
 * @returns 結果を埋めたテスト
 */
export const runConnectivityTest = (
  w: World,
  spec: ConnectivitySpec,
  now: string,
): ConnectivityTest => {
  const source = w.instances.find(
    (i) =>
      i.projectId === spec.projectId &&
      i.zone === spec.sourceZone &&
      i.name === spec.sourceInstance,
  );
  const protocol = spec.protocol.toLowerCase();
  const decide = (): Decision => {
    if (source === undefined) {
      return { allowed: false, reason: "source-not-found", rule: "", logging: false };
    }
    const external =
      spec.destinationKind === "ip"
        ? vmWithIp(w, spec.projectId, spec.destination, "external")
        : undefined;
    if (external !== undefined) {
      return viaExternalIp(w, source, external, spec);
    }
    // 同じ内部 IP を持つ VM が複数の VPC にあれば（auto モードの VPC どうしは範囲が重なる）、
    // 送信元と同じ VPC の VM を宛先とみなす。
    const sourceNetwork = source.networkInterfaces[0]?.network;
    const internal =
      spec.destinationKind === "ip"
        ? (w.instances.find(
            (i) =>
              i.projectId === spec.projectId &&
              i.networkInterfaces.some(
                (n) => n.networkIP === spec.destination && n.network === sourceNetwork,
              ),
          ) ?? vmWithIp(w, spec.projectId, spec.destination, "internal"))
        : undefined;
    // 内部 IP は、同じ VPC（またはピアリング先）の VM のものだけが宛先になる。別の VPC の VM が
    // 同じ形の内部 IP を持っていても、送信元の VPC にはその範囲へのルートが無い。
    const check: Check = {
      projectId: spec.projectId,
      name: source.name,
      region: source.zone.slice(0, -2),
      zone: source.zone,
      destination:
        spec.destinationKind === "instance"
          ? spec.destination
          : internal !== undefined
            ? internal.name
            : spec.destination,
      destinationProject: spec.projectId,
      destinationZone:
        spec.destinationKind === "instance"
          ? spec.destinationZone
          : (internal?.zone ?? spec.sourceZone),
      protocol,
      port: spec.port,
      allowed: false,
      reason: "",
      dns: "",
    };
    return evaluateConnection(w, check);
  };
  const decision = decide();
  return {
    ...spec,
    result: decision.allowed ? "REACHABLE" : "UNREACHABLE",
    cause: decision.allowed ? "" : causeOf(decision),
    rule: decision.rule === "implied" ? "" : decision.rule,
    verifyTime: now,
  };
};

const instanceLink = (projectId: string, zone: string, name: string): string =>
  `projects/${projectId}/zones/${zone}/instances/${name}`;

/** `describe` の形（本物の ConnectivityTest リソースの主要な項目）。 */
export const connectivityTestRecord = (t: ConnectivityTest): JsonRecord => {
  const lastStep: JsonRecord =
    t.result === "REACHABLE"
      ? { state: "DELIVER", description: "Packet is delivered to the destination." }
      : {
          state: "DROP",
          drop: { cause: t.cause, ...(t.rule === "" ? {} : { firewallRule: t.rule }) },
        };
  return {
    name: `projects/${t.projectId}/locations/global/connectivityTests/${t.name}`,
    source: { instance: instanceLink(t.projectId, t.sourceZone, t.sourceInstance) },
    destination:
      t.destinationKind === "instance"
        ? {
            instance: instanceLink(t.projectId, t.destinationZone, t.destination),
            ...(t.protocol === "ICMP" ? {} : { port: t.port }),
          }
        : { ipAddress: t.destination, ...(t.protocol === "ICMP" ? {} : { port: t.port }) },
    protocol: t.protocol,
    reachabilityDetails: {
      result: t.result,
      verifyTime: t.verifyTime,
      traces: [
        {
          steps: [
            {
              state: "START_FROM_INSTANCE",
              instance: { displayName: t.sourceInstance },
            },
            ...(t.rule === "" || t.result === "UNREACHABLE"
              ? []
              : [{ state: "APPLY_INGRESS_FIREWALL_RULE", firewall: { displayName: t.rule } }]),
            lastStep,
          ],
        },
      ],
    },
  };
};

/** 宛先 IP の綴りか。 */
export const isIpAddress = (value: string): boolean => Ipv4.address(value).some;
