import type { ReactElement } from "react";
import { SectionHeading } from "@/components/SectionHeading";
import {
  DefaultScopes,
  ExternalIp,
  FirewallRule,
  Instance,
  ProtocolRule,
  type ProtocolRule as ProtocolRuleType,
} from "@/engine/domains/compute";
import { LbScope } from "@/engine/domains/load-balancing";
import { lbHealth } from "@/engine/domains/load-balancing/graph";
import { World } from "@/engine/domains/world";
import {
  Absent,
  Empty,
  joined,
  NotFound,
  type Row,
  Section,
  type SelectionProps,
} from "@/features/simulator/components/PropertyParts";
import { Option } from "@/utils/Option";

/** Compute Engine と VPC のプロパティ（UC-007）。 */

const protocolText = (rules: readonly ProtocolRuleType[]): string =>
  rules.map(ProtocolRule.toText).join(", ") || Absent;

const scopeText = (scope: LbScope): string => LbScope.toPath(scope);

/** 時刻の綴り。ISO 8601 の秒まで（ミリ秒とタイムゾーンは落とす: モック 2a）。 */
const timestamp = (iso: string): string => iso.slice(0, 19);

/** タグの札（モック 2a の `http-server`）。 */
const TagChips = ({ tags }: Readonly<{ tags: readonly string[] }>): ReactElement =>
  tags.length === 0 ? (
    <span>{Empty}</span>
  ) : (
    <span className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span key={tag} className="rounded bg-code px-2 py-0.5 text-[13px]">
          {tag}
        </span>
      ))}
    </span>
  );

export const InstanceProperties = ({
  world,
  selection,
}: SelectionProps<"instance">): ReactElement => {
  const instance = World.findInstance(world, selection.projectId, selection.zone, selection.name);
  if (!Option.isSome(instance)) return <NotFound what="インスタンス" />;
  const i = instance.value;
  const nic = i.networkInterfaces[0];
  const rules = World.firewallRulesOf(world, i.projectId).filter(
    (r) => FirewallRule.appliesTo(r, i) && r.targetTags.length > 0,
  );
  const operations = World.operationsOfTarget(world, Instance.selfLink(i));
  const metadata = Object.entries(i.metadata);
  const hasDefaultScopes =
    i.scopes.length === DefaultScopes.length && DefaultScopes.every((s) => i.scopes.includes(s));
  const bootDisk = i.disks.find((d) => d.boot);
  const automaticRestart = !i.preemptible && i.provisioningModel === "STANDARD";
  return (
    <>
      <Section
        title="基本"
        rows={[
          { label: "machineType", value: i.machineType },
          { label: "zone", value: i.zone },
          {
            label: "scheduling",
            value: `${i.provisioningModel}${i.preemptible ? " · preemptible" : ""}${automaticRestart ? " · 自動再起動" : ""}`,
          },
          { label: "creationTimestamp", value: timestamp(i.creationTimestamp) },
        ]}
      />
      <Section
        title="ネットワーク"
        rows={[
          {
            label: "network / subnet",
            value: nic === undefined ? Absent : `${nic.network} / ${nic.subnetwork}`,
          },
          { label: "internal IP", value: nic?.networkIP ?? Absent },
          {
            label: "external IP",
            value:
              nic === undefined ? (
                Absent
              ) : nic.externalIP.kind === "none" ? (
                "なし"
              ) : (
                <>
                  {Option.unwrapOr(ExternalIp.address(nic.externalIP), "(解放中)")}{" "}
                  <span className="font-sans text-muted">エフェメラル</span>
                </>
              ),
          },
          { label: "tags", value: <TagChips tags={i.tags} /> },
        ]}
      />
      {rules.length > 0 && (
        <div className="-mt-2 mb-5 flex flex-col gap-1 rounded-md bg-ok-soft px-3 py-2.5 text-sm">
          {rules.map((r) => (
            <p
              key={r.name}
              className="grid grid-cols-[1.25rem_auto_auto_1fr] items-baseline gap-x-2"
            >
              <span className="text-ok">↳</span>
              <span>適用されるファイアウォール：</span>
              <span className="font-bold font-mono">{r.name}</span>
              <span className="text-muted">{protocolText(r.allowed)} · タグ一致</span>
            </p>
          ))}
        </div>
      )}
      <Section
        title="ディスク"
        rows={[
          ...i.disks.map((d) => ({
            label: d.boot ? "boot" : d.deviceName,
            value: `${d.deviceName} · ${d.type} · ${d.sizeGb}GB`,
          })),
          ...(bootDisk === undefined
            ? []
            : [{ label: "image", value: bootDisk.sourceImage.split("/").at(-1) ?? Absent }]),
        ]}
      />
      <Section
        title="ID とアクセス"
        rows={[
          { label: "serviceAccount", value: i.serviceAccount },
          {
            label: "scopes",
            value: hasDefaultScopes
              ? `デフォルト（${DefaultScopes.length} 件）`
              : `${i.scopes.length} 件`,
          },
        ]}
      />
      {metadata.length > 0 && (
        <Section
          title="メタデータ"
          rows={metadata.map(([key, value]) => ({ label: key, value }))}
        />
      )}
      <section className="mb-5">
        <SectionHeading className="mb-2">オペレーション</SectionHeading>
        <ul className="flex flex-col gap-1 font-mono text-[14.5px]">
          {operations.map((o) => (
            <li key={o.id} className="flex gap-3">
              <span>{o.operationType}</span>
              <span className="text-ok">{o.status}</span>
              <span>{o.insertTime.slice(11, 19)}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
};

export const DiskProperties = ({ world, selection }: SelectionProps<"disk">): ReactElement => {
  const disk = World.findDisk(world, selection.projectId, selection.zone, selection.name);
  if (!Option.isSome(disk)) return <NotFound what="ディスク" />;
  const d = disk.value;
  return (
    <Section
      title="基本"
      rows={[
        { label: "zone", value: d.zone },
        { label: "sizeGb", value: String(d.sizeGb) },
        { label: "type", value: d.type },
        { label: "sourceImage", value: Option.unwrapOr(d.sourceImage, "(空のディスク)") },
        { label: "users", value: joined(d.users) },
        { label: "creationTimestamp", value: d.creationTimestamp },
      ]}
    />
  );
};

export const SnapshotProperties = ({
  world,
  selection,
}: SelectionProps<"snapshot">): ReactElement => {
  const snapshot = World.findNamed(world, "diskSnapshots", selection);
  if (!Option.isSome(snapshot)) return <NotFound what="スナップショット" />;
  const s = snapshot.value;
  return (
    <Section
      title="基本"
      rows={[
        { label: "sourceDisk", value: `${s.sourceDisk} (${s.sourceZone})` },
        { label: "diskSizeGb", value: String(s.diskSizeGb) },
        { label: "creationTimestamp", value: s.creationTimestamp },
      ]}
    />
  );
};

export const InstanceTemplateProperties = ({
  world,
  selection,
}: SelectionProps<"instance-template">): ReactElement => {
  const template = World.findNamed(world, "instanceTemplates", selection);
  if (!Option.isSome(template)) return <NotFound what="インスタンステンプレート" />;
  const t = template.value;
  return (
    <>
      <Section
        title="基本"
        rows={[
          { label: "machineType", value: t.machineType },
          { label: "image", value: `${t.image.family} (${t.image.project})` },
          { label: "bootDisk", value: `${t.bootDisk.type} · ${t.bootDisk.sizeGb}GB` },
          {
            label: "scheduling",
            value: `${t.provisioningModel}${t.preemptible ? " · preemptible" : ""}`,
          },
          { label: "creationTimestamp", value: t.creationTimestamp },
        ]}
      />
      <Section
        title="ネットワーク"
        rows={[
          {
            label: "network / subnet",
            value: `${t.network} / ${Option.unwrapOr(t.subnet, t.network)}`,
          },
          { label: "external IP", value: t.externalIp ? "エフェメラル" : "なし" },
          { label: "tags", value: joined(t.tags) },
        ]}
      />
      <Section
        title="ID とアクセス"
        rows={[
          { label: "serviceAccount", value: Option.unwrapOr(t.serviceAccount, "(既定)") },
          { label: "scopes", value: `${t.scopes.length} 件` },
        ]}
      />
    </>
  );
};

export const InstanceGroupProperties = ({
  world,
  selection,
}: SelectionProps<"instance-group">): ReactElement => {
  const group = Option.filter(
    World.findLocated(world, "instanceGroups", selection),
    (g) => g.location === selection.location,
  );
  if (!Option.isSome(group)) return <NotFound what="マネージドインスタンスグループ" />;
  const g = group.value;
  const autoscaling: readonly Row[] = Option.isSome(g.autoscaling)
    ? [
        {
          label: "autoscaling",
          value: `${g.autoscaling.value.minReplicas}〜${g.autoscaling.value.maxReplicas} 台 · CPU ${g.autoscaling.value.targetCpuUtilization * 100}% · cooldown ${g.autoscaling.value.coolDownPeriodSec}s`,
        },
      ]
    : [{ label: "autoscaling", value: "なし" }];
  return (
    <Section
      title="基本"
      rows={[
        { label: "location", value: g.location },
        { label: "template", value: g.template },
        { label: "targetSize", value: String(g.targetSize) },
        {
          label: "namedPorts",
          value: joined((g.namedPorts ?? []).map((p) => `${p.name}:${p.port}`)),
        },
        { label: "baseInstanceName", value: g.baseInstanceName },
        { label: "instances", value: joined(g.instanceNames) },
        ...autoscaling,
        { label: "creationTimestamp", value: g.creationTimestamp },
      ]}
    />
  );
};

export const NetworkProperties = ({
  world,
  selection,
}: SelectionProps<"network">): ReactElement => {
  const network = World.findNetwork(world, selection.projectId, selection.name);
  if (!Option.isSome(network)) return <NotFound what="ネットワーク" />;
  const subnets = World.subnetsOf(world, selection.projectId).filter(
    (s) => s.network === selection.name,
  );
  const peerings = World.namedOf(world, "peerings", selection.projectId).filter(
    (p) => p.network === selection.name,
  );
  return (
    <>
      <Section
        title="基本"
        rows={[
          { label: "name", value: network.value.name },
          { label: "subnetMode", value: network.value.subnetMode },
        ]}
      />
      <Section
        title="サブネット"
        rows={subnets.map((s) => ({ label: s.region, value: `${s.name} ${s.ipCidrRange}` }))}
      />
      {peerings.length > 0 && (
        <Section
          title="ピアリング"
          rows={peerings.map((p) => ({
            label: p.name,
            value: `${p.peerProjectId}/${p.peerNetwork} · ${p.state}`,
          }))}
        />
      )}
    </>
  );
};

export const SubnetProperties = ({ world, selection }: SelectionProps<"subnet">): ReactElement => {
  const subnet = World.findSubnet(world, selection.projectId, selection.region, selection.name);
  if (!Option.isSome(subnet)) return <NotFound what="サブネット" />;
  const s = subnet.value;
  const instances = World.instancesInSubnet(world, s);
  return (
    <Section
      title="基本"
      rows={[
        { label: "region", value: s.region },
        { label: "network", value: s.network },
        { label: "ipCidrRange", value: s.ipCidrRange },
        { label: "privateIpGoogleAccess", value: String(s.privateIpGoogleAccess) },
        { label: "purpose / role", value: `${s.purpose ?? "PRIVATE"} ${s.role ?? ""}` },
        { label: "instances", value: joined(instances.map((i) => i.name)) },
      ]}
    />
  );
};

export const FirewallProperties = ({
  world,
  selection,
}: SelectionProps<"firewall">): ReactElement => {
  const rule = World.findFirewallRule(world, selection.projectId, selection.name);
  if (!Option.isSome(rule)) return <NotFound what="ファイアウォールルール" />;
  const r = rule.value;
  return (
    <Section
      title="基本"
      rows={[
        { label: "network", value: r.network },
        { label: "direction", value: r.direction },
        { label: "priority", value: String(r.priority) },
        { label: "sourceRanges", value: r.sourceRanges.join(", ") || Absent },
        { label: "targetTags", value: r.targetTags.join(", ") || "(すべてのインスタンス)" },
        { label: "allow", value: protocolText(r.allowed) },
        { label: "deny", value: protocolText(r.denied) },
        { label: "disabled", value: String(r.disabled) },
      ]}
    />
  );
};

export const AddressProperties = ({
  world,
  selection,
}: SelectionProps<"address">): ReactElement => {
  const address = World.findLocated(world, "addresses", {
    ...selection,
    location: Option.unwrapOr(selection.region, "global"),
  });
  if (!Option.isSome(address)) return <NotFound what="アドレス" />;
  const a = address.value;
  return (
    <Section
      title="基本"
      rows={[
        { label: "address", value: a.address },
        { label: "addressType", value: a.addressType },
        { label: "networkTier", value: a.networkTier ?? "PREMIUM" },
        { label: "subnet", value: a.subnet ?? "-" },
        { label: "scope", value: Option.unwrapOr(a.region, "global") },
        { label: "status", value: a.status },
        { label: "creationTimestamp", value: a.creationTimestamp },
      ]}
    />
  );
};

export const RouterProperties = ({ world, selection }: SelectionProps<"router">): ReactElement => {
  const router = World.findNamed(world, "routers", selection);
  if (!Option.isSome(router)) return <NotFound what="ルータ" />;
  return (
    <Section
      title="基本"
      rows={[
        { label: "region", value: router.value.region },
        { label: "network", value: router.value.network },
        { label: "asn", value: String(router.value.asn) },
      ]}
    />
  );
};

export const HealthCheckProperties = ({
  world,
  selection,
}: SelectionProps<"health-check">): ReactElement => {
  const check = World.findLocated(world, "healthChecks", {
    ...selection,
    location: LbScope.toPath(selection.scope ?? LbScope.Global),
  });
  if (!Option.isSome(check)) return <NotFound what="ヘルスチェック" />;
  const c = check.value;
  return (
    <Section
      title="基本"
      rows={[
        { label: "scope", value: scopeText(c.scope ?? LbScope.Global) },
        { label: "requestPath", value: c.requestPath ?? "/" },
        { label: "protocol", value: c.protocol },
        { label: "port", value: String(c.port) },
        { label: "checkIntervalSec", value: String(c.checkIntervalSec) },
        { label: "timeoutSec", value: String(c.timeoutSec) },
      ]}
    />
  );
};

export const BackendServiceProperties = ({
  world,
  selection,
}: SelectionProps<"backend-service">): ReactElement => {
  const service = World.findLocated(world, "backendServices", {
    ...selection,
    location: LbScope.toPath(selection.scope),
  });
  if (!Option.isSome(service)) return <NotFound what="バックエンドサービス" />;
  const b = service.value;
  return (
    <Section
      title="基本"
      rows={[
        { label: "scope", value: scopeText(b.scope) },
        { label: "protocol", value: b.protocol },
        { label: "loadBalancingScheme", value: b.loadBalancingScheme },
        { label: "healthChecks", value: joined(b.healthChecks) },
        { label: "portName", value: b.portName ?? "http" },
        {
          label: "CDN / cacheMode",
          value: `${b.enableCdn ?? false} / ${b.cacheMode ?? "CACHE_ALL_STATIC"}`,
        },
        ...lbHealth(world, b).map((h) => ({
          label: `${h.instance}:${h.port}`,
          value: `${h.healthState} · app ready: ${h.trafficReady} · ${h.reasons.join(", ")}`,
        })),
        { label: "backends", value: joined(b.backends) },
        { label: "timeoutSec", value: String(b.timeoutSec) },
      ]}
    />
  );
};

export const ForwardingRuleProperties = ({
  world,
  selection,
}: SelectionProps<"forwarding-rule">): ReactElement => {
  const rule = World.findLocated(world, "forwardingRules", {
    ...selection,
    location: LbScope.toPath(selection.scope),
  });
  if (!Option.isSome(rule)) return <NotFound what="転送ルール" />;
  const r = rule.value;
  return (
    <Section
      title="基本"
      rows={[
        { label: "scope", value: scopeText(r.scope) },
        { label: "IPAddress", value: r.ipAddress },
        { label: "IPProtocol / ports", value: `${r.ipProtocol} ${r.portRange}` },
        { label: "loadBalancingScheme", value: r.loadBalancingScheme },
        { label: "target", value: r.target ?? r.backendService },
        { label: "network / subnet", value: `${r.network ?? "-"} / ${r.subnet ?? "-"}` },
        { label: "networkTier", value: r.networkTier ?? "PREMIUM" },
        { label: "creationTimestamp", value: r.creationTimestamp },
      ]}
    />
  );
};
