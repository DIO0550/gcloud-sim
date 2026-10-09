import type { ReactElement } from "react";
import { databasesOf, findServer, type Server } from "@/engine/domains/relational/model";
import type { World } from "@/engine/domains/world";
import { NotFound, type Row, Section, type SelectionProps } from "./PropertyParts";
export const DatabaseServerSections = ({
  world,
  server,
}: {
  world: World;
  server: Server;
}): ReactElement => {
  const databases = databasesOf(world, server);
  const users = world.relational.users.filter(
    (u) => u.projectId === server.projectId && u.kind === server.kind && u.server === server.name,
  );
  const copies = world.relational.copies.filter(
    (c) => c.projectId === server.projectId && c.kind === server.kind && c.source === server.name,
  );
  const queries = world.relational.queries
    .filter(
      (q) => q.projectId === server.projectId && q.kind === server.kind && q.server === server.name,
    )
    .slice(-5);
  const rows: Row[] = [
    { label: "engine / HA", value: `${server.engine} / ${server.availability}` },
    { label: "private VPC", value: server.network || "未設定" },
    { label: "public IP", value: server.publicIp ? "有効" : "無効" },
    { label: "authorized networks", value: server.authorizedNetworks.join(", ") || "未設定" },
    { label: "read replica of", value: server.master || "primary" },
    { label: "failovers / PITR", value: `${server.failovers} / ${server.pitr}` },
    { label: "writes", value: server.frozen ? "停止" : "有効" },
    ...users.map((u) => ({ label: `user: ${u.name}`, value: u.role })),
    ...databases.flatMap((d) => [
      { label: `database: ${d.name}`, value: d.vector ? "vector拡張あり" : "SQL" },
      ...d.tables.map((t) => ({
        label: `table: ${d.name}.${t.name}`,
        value: `${t.rows.length} rows · ${t.columns.map((c) => `${c.name}:${c.type}${c.primary ? " (PK)" : ""}`).join(", ")}`,
      })),
    ]),
    ...copies.map((c) => ({
      label: `${c.type}: ${c.name}`,
      value: `${c.timestamp} · ${c.databases.length} databases`,
    })),
  ];
  return (
    <>
      <Section title="接続・可用性・データ" rows={rows} />
      <Section
        title="最近の照会結果"
        rows={
          queries.length
            ? queries.map((q, i) => ({
                label: `query ${i + 1}: ${q.database} (${q.user})`,
                value: `${q.mode} · affected=${q.affected} · ${q.rows.length} rows · ${JSON.stringify(q.rows.slice(0, 5)).slice(0, 2000)}${q.rows.length > 5 ? "（先頭5行）" : ""}`,
              }))
            : [{ label: "未実行", value: "sim sql execute / sim alloydb execute で確認" }]
        }
      />
    </>
  );
};
export const RelationalProperties = ({
  world,
  selection,
}: SelectionProps<"relational">): ReactElement => {
  const { resource, projectId, name, region, cluster } = selection;
  if (resource === "alloy-cluster") {
    const server = findServer(world, { projectId, kind: "alloy", name });
    if (!server || server.region !== region) {
      return <NotFound what="AlloyDB cluster" />;
    }
    return <DatabaseServerSections world={world} server={server} />;
  }
  let record: object | undefined;
  if (resource === "alloy-instance") {
    record = world.relational.alloyInstances.find(
      (i) =>
        i.projectId === projectId &&
        i.cluster === cluster &&
        i.region === region &&
        i.name === name,
    );
  }
  if (resource === "alloy-backup") {
    record = world.relational.copies.find(
      (c) =>
        c.projectId === projectId &&
        c.kind === "alloy" &&
        c.type === "BACKUP" &&
        c.name === name &&
        c.region === region,
    );
  }
  if (resource === "dms-profile") {
    record = world.relational.profiles.find(
      (p) => p.projectId === projectId && p.name === name && p.region === region,
    );
  }
  if (resource === "dms-job") {
    record = world.relational.migrations.find(
      (j) => j.projectId === projectId && j.name === name && j.region === region,
    );
  }
  if (!record) {
    return <NotFound what="データベースリソース" />;
  }
  return (
    <Section
      title="構成・状態"
      rows={Object.entries(record).map(([label, value]) => ({
        label,
        value: Array.isArray(value) ? `${value.length} databases` : String(value),
      }))}
    />
  );
};
