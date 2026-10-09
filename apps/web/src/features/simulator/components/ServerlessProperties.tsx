import type { ReactElement } from "react";
import { cacheOf } from "@/engine/domains/managed-databases/cache";
import { latestRevision } from "@/engine/domains/serverless-lab/model";
import { NotFound, type Row, Section, type SelectionProps } from "./PropertyParts";

export const ServerlessProperties = ({
  world,
  selection,
}: SelectionProps<"serverless-lab">): ReactElement => {
  const items = world.serverlessLab[selection.collection];
  const resource = items.find(
    (r) =>
      r.projectId === selection.projectId &&
      r.region === selection.region &&
      r.name === selection.name &&
      (!("kind" in r) || r.kind === selection.subtype) &&
      (!("ring" in r) || r.ring === selection.subtype),
  );
  if (!resource) {
    return <NotFound what="サーバーレスリソース" />;
  }
  const rows: Row[] = [
    { label: "project", value: resource.projectId },
    { label: "location", value: resource.region },
  ];
  if ("revisions" in resource) {
    const c = latestRevision(resource).config;
    rows.push(
      { label: "latest revision", value: latestRevision(resource).name },
      { label: "runtime SA", value: c.serviceAccount },
      { label: "min / max", value: `${c.minInstances} / ${c.maxInstances}` },
      { label: "concurrency", value: String(c.concurrency) },
      { label: "CPU / memory", value: `${c.cpu} CPU / ${c.memoryMb} MiB` },
      { label: "timeout", value: `${c.timeoutSeconds} s` },
      { label: "ingress / egress", value: `${c.ingress} / ${c.egress}` },
      { label: "connector", value: c.connector || "未設定" },
      { label: "CMEK", value: c.cmek || "未設定" },
      {
        label: "secrets（参照）",
        value:
          Object.entries(c.secrets)
            .map(([key, value]) => `${key} → ${value}`)
            .join(", ") || "未設定",
      },
      {
        label: "environment",
        value:
          Object.entries(c.env)
            .map(([key, value]) => `${key}=${value}`)
            .join(", ") || "未設定",
      },
      { label: "trigger", value: `${resource.trigger.kind} ${resource.trigger.source}` },
      { label: "retry / idempotent", value: `${resource.retry} / ${c.idempotent}` },
      ...resource.revisions.map((r) => ({
        label: `revision ${r.name}`,
        value: `${r.image} · ${resource.traffic[r.name] ?? 0}%`,
      })),
      ...resource.invocations
        .slice(-5)
        .map((v, i) => ({ label: `invocation ${i + 1}`, value: `${v.status}: ${v.reason}` })),
      ...world.serverlessLab.deliveries
        .filter(
          (d) =>
            d.target ===
            `${resource.projectId}/${resource.region}/${resource.kind}/${resource.name}`,
        )
        .map((d) => ({
          label: `event ${d.eventId}`,
          value: `${d.status} · attempts=${d.attempts} · effects=${d.effects} · duplicates=${d.duplicates}`,
        })),
    );
  }
  if ("versions" in resource) {
    rows.push(
      ...resource.versions.map((v) => ({
        label: `version ${v.id}`,
        value: `${v.state} · ${new TextEncoder().encode(v.data).length} bytes（値は非表示）`,
      })),
    );
  }
  if ("network" in resource) {
    rows.push({ label: "network", value: resource.network });
  }
  if ("range" in resource) {
    rows.push({ label: "range", value: resource.range });
  }
  if ("host" in resource) {
    const cache = cacheOf(world, resource);
    rows.push(
      { label: "tier / failovers", value: `${cache.tier} / ${cache.failovers}` },
      ...cache.entries.map((e) => ({
        label: `key ${e.key}`,
        value: `${e.value} · ${e.expiresAt === 0 ? "no expiry" : `expires at virtual ${e.expiresAt}s`}`,
      })),
    );
    rows.push(
      { label: "host", value: resource.host },
      { label: "size", value: `${resource.sizeGb} GiB` },
    );
  }
  if ("mode" in resource) {
    rows.push(
      { label: "mode", value: resource.mode },
      { label: "consistency", value: "STRONG" },
      ...world.serverlessLab.documents
        .filter((d) => d.projectId === resource.projectId && d.database === resource.name)
        .map((d) => ({ label: d.path, value: `${d.data} · version=${d.version}` })),
      ...world.managedDatabases.indexes
        .filter((i) => i.projectId === resource.projectId && i.database === resource.name)
        .map((i) => ({
          label: `index ${i.name}`,
          value: `${i.collection}: ${i.fields.join(", ")}`,
        })),
      ...world.managedDatabases.firestoreCopies
        .filter((c) => c.projectId === resource.projectId && c.database === resource.name)
        .map((c) => ({
          label: `backup ${c.name}`,
          value: `${c.location} · ${c.documents.length} documents`,
        })),
    );
  }
  if ("enabled" in resource) {
    rows.push(
      { label: "key ring", value: resource.ring },
      { label: "primary version", value: resource.enabled ? "ENABLED" : "DISABLED" },
    );
  }
  if ("filter" in resource) {
    rows.push(
      { label: "destination", value: resource.target },
      { label: "trigger SA", value: resource.serviceAccount },
      { label: "event filter", value: JSON.stringify(resource.filter) },
    );
  }
  if ("steps" in resource) {
    rows.push(
      { label: "execution SA", value: resource.serviceAccount },
      { label: "steps", value: resource.steps.join(" → ") },
      ...resource.executions
        .slice(-5)
        .map((v, i) => ({ label: `execution ${i + 1}`, value: `${v.status}: ${v.reason}` })),
    );
  }
  rows.push(
    ...world.managedDatabases.observations
      .filter(
        (o) =>
          o.projectId === resource.projectId &&
          (o.resource === resource.name || o.resource === `${resource.region}/${resource.name}`),
      )
      .slice(-5)
      .map((o, i) => ({ label: `result ${i + 1}: ${o.operation}`, value: o.result })),
  );
  if ("policy" in resource) {
    rows.push(
      ...resource.policy.bindings.map((b) => ({ label: b.role, value: b.members.join(", ") })),
    );
  }
  return (
    <Section
      title="設定・実行結果"
      rows={[
        ...rows,
        {
          label: "教材の再現範囲",
          value:
            "固定ハンドラの設定・権限・依存関係・配送履歴を評価します。実通信・課金・任意コード実行は行いません。",
        },
      ]}
    />
  );
};
