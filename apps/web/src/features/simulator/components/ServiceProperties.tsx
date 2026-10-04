import type { ReactElement } from "react";
import { ImagePull } from "@/engine/domains/image-pull";
import { KubeEnv, KubeRuntime } from "@/engine/domains/kube-config";
import { KubeHpa } from "@/engine/domains/kube-hpa";
import { KubeLabels } from "@/engine/domains/kube-labels";
import { KubeResources } from "@/engine/domains/kube-resources";
import { KubeServiceRouting } from "@/engine/domains/kube-service-routing";

import { KubePod, KubeService } from "@/engine/domains/kubernetes";
import { CloudRunService, GkeCluster } from "@/engine/domains/managed-services";
import { AppEngineApp, CloudFunction } from "@/engine/domains/serverless";
import { World } from "@/engine/domains/world";
import {
  Absent,
  Empty,
  IamSection,
  joined,
  NotFound,
  Section,
  type SelectionProps,
} from "@/features/simulator/components/PropertyParts";
import { Option } from "@/utils/Option";

/** Cloud Storage・GKE・Cloud Run・サーバーレス・データ・運用系サービスのプロパティ（UC-007）。 */

export const BucketProperties = ({ world, selection }: SelectionProps<"bucket">): ReactElement => {
  const bucket = World.findBucket(world, selection.name);
  if (!Option.isSome(bucket)) return <NotFound what="バケット" />;
  const b = bucket.value;
  return (
    <>
      <Section
        title="基本"
        rows={[
          { label: "location", value: b.location },
          { label: "storageClass", value: b.storageClass },
          { label: "uniformBucketLevelAccess", value: String(b.uniformBucketLevelAccess) },
          { label: "publicAccessPrevention", value: String(b.publicAccessPrevention) },
          { label: "versioning", value: String(b.versioning) },
          { label: "lifecycleRules", value: String(b.lifecycleRules.length) },
          { label: "objects", value: String(b.objects.length) },
        ]}
      />
      <IamSection world={world} target={{ type: "bucket", id: b.name }} />
    </>
  );
};

export const ClusterProperties = ({
  world,
  selection,
}: SelectionProps<"cluster">): ReactElement => {
  const cluster = World.findCluster(world, selection.projectId, selection.name);
  if (!Option.isSome(cluster)) return <NotFound what="クラスタ" />;
  const c = cluster.value;
  return (
    <Section
      title="基本"
      rows={[
        { label: "location", value: c.location },
        { label: "mode", value: c.autopilot ? "Autopilot" : "Standard" },
        { label: "nodeCount", value: String(c.nodeCount) },
        { label: "machineType", value: c.machineType },
        { label: "nodeServiceAccount", value: c.nodeServiceAccount || "default" },
        { label: "masterVersion", value: c.currentMasterVersion },
        { label: "status", value: c.status },
        { label: "selfLink", value: GkeCluster.selfLink(c) },
      ]}
    />
  );
};

export const NodePoolProperties = ({
  world,
  selection,
}: SelectionProps<"node-pool">): ReactElement => {
  const cluster = World.findCluster(world, selection.projectId, selection.cluster);
  const pool = Option.flatMap(cluster, (c) =>
    Option.fromNullable(
      World.nodePoolsWithDefault(world, c).find((p) => p.name === selection.name),
    ),
  );
  if (!Option.isSome(pool)) return <NotFound what="ノードプール" />;
  return (
    <Section
      title="基本"
      rows={[
        { label: "cluster", value: pool.value.cluster },
        { label: "machineType", value: pool.value.machineType },
        { label: "nodeCount", value: String(pool.value.nodeCount) },
        { label: "diskSizeGb", value: String(pool.value.diskSizeGb) },
        { label: "version", value: pool.value.version },
      ]}
    />
  );
};

export const KubeDeploymentProperties = ({
  world,
  selection,
}: SelectionProps<"kube-deployment">): ReactElement => {
  const cluster = World.findCluster(world, selection.projectId, selection.cluster);
  const deployment = Option.flatMap(cluster, (c) =>
    World.findKubeDeployment(world, c, selection.name),
  );
  if (!Option.isSome(deployment)) return <NotFound what="Deployment" />;
  const d = deployment.value;
  return (
    <>
      <Section
        title="基本"
        rows={[
          { label: "cluster", value: d.cluster },
          { label: "image", value: d.image },
          { label: "labels", value: KubeLabels.text(d.labels) },
          { label: "selector", value: KubeLabels.text(d.selector) },
          { label: "Pod labels", value: KubeLabels.text(d.podLabels) },
          { label: "Pod QoS", value: KubeResources.qosClass(d.resources) },
          { label: "replicas", value: String(d.replicas) },
          { label: "generation", value: String(d.generation) },
          { label: "revision", value: String(d.revision) },
          { label: "createdAt", value: d.createdAt },
        ]}
      />
      {!KubeResources.equal(d.resources, KubeResources.empty()) && (
        <Section
          title="CPU・メモリ（1 Podあたり）"
          rows={[
            { label: "requests", value: KubeResources.text(d.resources.requests) },
            { label: "limits", value: KubeResources.text(d.resources.limits) },
          ]}
        />
      )}
      <Section
        title="更新履歴（最大11件）"
        rows={d.revisions.map((r) => ({
          label: `revision ${r.revision} (${r.reason})`,
          value: r.image,
        }))}
      />
      <Section
        title="環境変数（Pod template）"
        rows={d.env.map((e) => ({ label: e.name, value: KubeEnv.display(e) }))}
      />
      <Section
        title="Pod"
        rows={KubePod.fromDeployment(d).map((p) => ({
          label: p.name,
          value: Option.isSome(cluster)
            ? ImagePull.error(world, cluster.value, d.image) ||
              KubeRuntime.error(world.kubeConfigs, d, p.name) ||
              `${p.status} ${p.ip}`
            : "Unknown",
        }))}
      />
    </>
  );
};

export const KubeServiceProperties = ({
  world,
  selection,
}: SelectionProps<"kube-service">): ReactElement => {
  const cluster = World.findCluster(world, selection.projectId, selection.cluster);
  const service = Option.flatMap(cluster, (c) => World.findKubeService(world, c, selection.name));
  if (!Option.isSome(service)) return <NotFound what="Service" />;
  const s = service.value;
  return (
    <Section
      title="基本"
      rows={[
        { label: "cluster", value: s.cluster },
        { label: "type", value: s.type },
        { label: "labels", value: KubeLabels.text(s.labels) },
        { label: "selector", value: KubeLabels.text(s.selector) },
        {
          label: "backend Pods",
          value:
            KubeServiceRouting.backends(world, s)
              .map((b) => b.pod)
              .join(", ") || Absent,
        },
        { label: "targetPort", value: String(s.targetPort) },
        { label: "endpoints", value: KubeServiceRouting.endpoints(world, s).join(", ") || Absent },
        { label: "ports", value: KubeService.portsText(s) },
        { label: "clusterIP", value: s.clusterIp },
        { label: "externalIP", value: Option.unwrapOr(s.externalIp, Absent) },
        { label: "createdAt", value: s.createdAt },
      ]}
    />
  );
};

export const RunServiceProperties = ({
  world,
  selection,
}: SelectionProps<"run-service">): ReactElement => {
  const service = World.findRunService(world, selection.projectId, selection.name);
  if (!Option.isSome(service)) return <NotFound what="サービス" />;
  const s = service.value;
  return (
    <Section
      title="基本"
      rows={[
        { label: "region", value: s.region },
        { label: "image", value: s.image },
        { label: "url", value: CloudRunService.url(s) },
        { label: "revision", value: CloudRunService.revisionName(s) },
        { label: "unauthenticated", value: s.allowUnauthenticated ? "許可" : "拒否" },
        { label: "lastDeployedAt", value: s.lastDeployedAt },
      ]}
    />
  );
};

export const FunctionProperties = ({
  world,
  selection,
}: SelectionProps<"function">): ReactElement => {
  const fn = World.findNamed(world, "functions", selection);
  if (!Option.isSome(fn)) return <NotFound what="関数" />;
  const f = fn.value;
  return (
    <Section
      title="基本"
      rows={[
        { label: "region", value: f.region },
        { label: "runtime", value: f.runtime },
        { label: "entryPoint", value: f.entryPoint },
        {
          label: "trigger",
          value: f.trigger.kind === "http" ? "HTTP" : `Pub/Sub topic ${f.trigger.topic}`,
        },
        { label: "url", value: Option.unwrapOr(CloudFunction.url(f), Absent) },
        { label: "unauthenticated", value: f.allowUnauthenticated ? "許可" : "拒否" },
        { label: "memory", value: `${f.memoryMb}MB` },
        { label: "versionId", value: String(f.versionId) },
        { label: "updateTime", value: f.updateTime },
      ]}
    />
  );
};

export const AppEngineProperties = ({
  world,
  selection,
}: SelectionProps<"app-engine">): ReactElement => {
  const app = World.findAppEngineApp(world, selection.projectId);
  if (!Option.isSome(app)) return <NotFound what="App Engine アプリ" />;
  const versions = world.appVersions.filter((v) => v.projectId === selection.projectId);
  return (
    <>
      <Section
        title="基本"
        rows={[
          { label: "region", value: app.value.region },
          { label: "defaultHostname", value: AppEngineApp.defaultHostname(app.value) },
          { label: "createTime", value: app.value.createTime },
        ]}
      />
      <Section
        title="バージョン"
        rows={
          versions.length === 0
            ? [{ label: Empty, value: "gcloud app deploy でデプロイ" }]
            : versions.map((v) => ({
                label: `${v.service}/${v.id}`,
                value: `${v.runtime} · traffic ${v.trafficSplit * 100}%`,
              }))
        }
      />
    </>
  );
};

export const AppVersionProperties = ({
  world,
  selection,
}: SelectionProps<"app-version">): ReactElement => {
  const version = World.appVersionsOf(world, selection.projectId, selection.service).find(
    (v) => v.id === selection.id,
  );
  if (version === undefined) return <NotFound what="バージョン" />;
  return (
    <Section
      title="基本"
      rows={[
        { label: "service", value: version.service },
        { label: "id", value: version.id },
        { label: "runtime", value: version.runtime },
        { label: "trafficSplit", value: `${version.trafficSplit * 100}%` },
        { label: "createTime", value: version.createTime },
      ]}
    />
  );
};

export const SqlInstanceProperties = ({
  world,
  selection,
}: SelectionProps<"sql-instance">): ReactElement => {
  const instance = World.findNamed(world, "sqlInstances", selection);
  if (!Option.isSome(instance)) return <NotFound what="Cloud SQL インスタンス" />;
  const i = instance.value;
  const backups = World.sqlBackupsOf(world, selection.projectId, selection.name);
  return (
    <>
      <Section
        title="基本"
        rows={[
          { label: "databaseVersion", value: i.databaseVersion },
          { label: "tier", value: i.tier },
          { label: "region / zone", value: `${i.region} / ${i.gceZone}` },
          { label: "ipAddress", value: i.ipAddress },
          { label: "state", value: i.state },
          { label: "createTime", value: i.createTime },
        ]}
      />
      <Section
        title="バックアップ"
        rows={
          backups.length === 0
            ? [{ label: Empty, value: "gcloud sql backups create で作成" }]
            : backups.map((b) => ({ label: b.id, value: `${b.status} ${b.windowStartTime}` }))
        }
      />
    </>
  );
};

export const TopicProperties = ({ world, selection }: SelectionProps<"topic">): ReactElement => {
  const topic = World.findNamed(world, "pubsubTopics", selection);
  if (!Option.isSome(topic)) return <NotFound what="トピック" />;
  const subscriptions = World.namedOf(world, "pubsubSubscriptions", selection.projectId).filter(
    (s) => s.topic === selection.name,
  );
  return (
    <Section
      title="基本"
      rows={[
        { label: "createTime", value: topic.value.createTime },
        { label: "subscriptions", value: joined(subscriptions.map((s) => s.name)) },
      ]}
    />
  );
};

export const SubscriptionProperties = ({
  world,
  selection,
}: SelectionProps<"subscription">): ReactElement => {
  const subscription = World.findNamed(world, "pubsubSubscriptions", selection);
  if (!Option.isSome(subscription)) return <NotFound what="サブスクリプション" />;
  const s = subscription.value;
  return (
    <Section
      title="基本"
      rows={[
        { label: "topic", value: s.topic },
        { label: "type", value: Option.isSome(s.pushEndpoint) ? "PUSH" : "PULL" },
        { label: "pushEndpoint", value: Option.unwrapOr(s.pushEndpoint, Absent) },
        { label: "ackDeadlineSeconds", value: String(s.ackDeadlineSeconds) },
        { label: "createTime", value: s.createTime },
      ]}
    />
  );
};

export const LogSinkProperties = ({
  world,
  selection,
}: SelectionProps<"log-sink">): ReactElement => {
  const sink = World.findNamed(world, "logSinks", selection);
  if (!Option.isSome(sink)) return <NotFound what="シンク" />;
  const s = sink.value;
  return (
    <Section
      title="基本"
      rows={[
        { label: "destination", value: s.destination },
        { label: "filter", value: s.filter || Absent },
        { label: "writerIdentity", value: s.writerIdentity },
        { label: "createTime", value: s.createTime },
      ]}
    />
  );
};

export const KeyRingProperties = ({
  world,
  selection,
}: SelectionProps<"key-ring">): ReactElement => {
  const ring = World.findLocated(world, "kmsKeyRings", selection);
  if (!Option.isSome(ring)) return <NotFound what="キーリング" />;
  return (
    <Section
      title="基本"
      rows={[
        { label: "location", value: ring.value.location },
        { label: "createTime", value: ring.value.createTime },
      ]}
    />
  );
};

export const DnsZoneProperties = ({
  world,
  selection,
}: SelectionProps<"dns-zone">): ReactElement => {
  const zone = World.findNamed(world, "dnsZones", selection);
  if (!Option.isSome(zone)) return <NotFound what="マネージドゾーン" />;
  const z = zone.value;
  return (
    <Section
      title="基本"
      rows={[
        { label: "dnsName", value: z.dnsName },
        { label: "description", value: z.description || Absent },
        { label: "visibility", value: z.visibility },
        { label: "nameServers", value: joined(z.nameServers) },
        { label: "createTime", value: z.createTime },
      ]}
    />
  );
};

export const DmDeploymentProperties = ({
  world,
  selection,
}: SelectionProps<"dm-deployment">): ReactElement => {
  const deployment = World.findNamed(world, "dmDeployments", selection);
  if (!Option.isSome(deployment)) return <NotFound what="デプロイメント" />;
  const d = deployment.value;
  return (
    <>
      <Section
        title="基本"
        rows={[
          { label: "config", value: d.config },
          { label: "insertTime", value: d.insertTime },
        ]}
      />
      <Section title="リソース" rows={d.resources.map((r) => ({ label: r.name, value: r.type }))} />
    </>
  );
};

export const ObservabilityProperties = ({
  world,
  selection,
}: SelectionProps<"observability">): ReactElement => {
  const resource = World.findNamed(world, selection.collection, selection);
  if (!Option.isSome(resource)) return <NotFound what="監視設定" />;
  return (
    <Section
      title="設定"
      rows={Object.entries(resource.value).map(([label, value]) => ({
        label,
        value: String(value),
      }))}
    />
  );
};

export const KubeConfigProperties = ({
  world,
  selection,
}: SelectionProps<"kube-config">): ReactElement => {
  const c = world.kubeConfigs.find(
    (c) =>
      c.projectId === selection.projectId &&
      c.cluster === selection.cluster &&
      c.kind === selection.resourceKind &&
      c.name === selection.name,
  );
  if (!c) return <NotFound what={selection.resourceKind} />;
  return (
    <>
      <Section
        title="基本"
        rows={[
          { label: "cluster", value: c.cluster },
          { label: "namespace", value: "default" },
          { label: "kind", value: c.kind },
        ]}
      />
      <Section
        title={c.kind === "secret" ? "データ（値は非表示）" : "データ"}
        rows={c.data.map((e) => ({
          label: e.key,
          value:
            c.kind === "secret" ? `${new TextEncoder().encode(e.value).length} bytes` : e.value,
        }))}
      />
    </>
  );
};

export const KubeHpaProperties = ({
  world,
  selection,
}: SelectionProps<"kube-hpa">): ReactElement => {
  const h = world.kubeHpas.find(
    (h) =>
      h.projectId === selection.projectId &&
      h.cluster === selection.cluster &&
      h.name === selection.name,
  );
  if (!h) return <NotFound what="HPA" />;
  const d = world.kubeDeployments.find(
    (d) => d.projectId === h.projectId && d.cluster === h.cluster && d.name === h.target,
  );
  return (
    <>
      <Section
        title="CPUによるレプリカ調整"
        rows={[
          { label: "対象", value: `Deployment/${h.target}` },
          { label: "最小 / 最大", value: `${h.minReplicas} / ${h.maxReplicas}` },
          { label: "CPU使用率の目標", value: `${h.targetCpu}%（request比）` },
          { label: "現在のレプリカ数", value: d ? String(d.replicas) : "対象なし" },
        ]}
      />
      {Option.isSome(h.lastEvaluation) ? (
        <Section
          title="前回の教材評価"
          rows={[
            { label: "評価時刻", value: h.lastEvaluation.value.evaluatedAt },
            { label: "入力CPU（1 Pod）", value: `${h.lastEvaluation.value.cpuMilli}m` },
            { label: "CPU使用率 / 目標", value: KubeHpa.targets(h) },
            {
              label: "レプリカ数",
              value: `${h.lastEvaluation.value.currentReplicas} → ${h.lastEvaluation.value.desiredReplicas}`,
            },
            { label: "判定", value: h.lastEvaluation.value.reason },
          ]}
        />
      ) : (
        <p className="mb-3 text-sm text-muted">
          未評価です。sim kubernetes reconcileでCPU使用量を指定してください。
        </p>
      )}
      <p className="mb-3 text-sm text-muted">
        明示したCPU使用量を1回ずつ評価します。前回の値は実測値ではありません。定期実行・安定化待機は再現しません。
      </p>
    </>
  );
};
