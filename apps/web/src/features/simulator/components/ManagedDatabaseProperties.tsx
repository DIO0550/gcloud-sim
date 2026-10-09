import type { ReactElement } from "react";
import { NotFound, type Row, Section, type SelectionProps } from "./PropertyParts";

export const ManagedDatabaseProperties = ({
  world,
  selection,
}: SelectionProps<"managed-database">): ReactElement => {
  const r = world.managedDatabases[selection.collection].find(
    (r) =>
      r.projectId === selection.projectId &&
      r.name === selection.name &&
      (!("instance" in r) || r.instance === selection.instance) &&
      (!("cluster" in r) || r.cluster === selection.cluster),
  );
  if (!r) {
    return <NotFound what="データベースリソース" />;
  }
  const rows: Row[] = [{ label: "project", value: r.projectId }];
  if ("config" in r) {
    rows.push({ label: "config", value: r.config });
  }
  if ("processingUnits" in r) {
    rows.push(
      { label: "capacity", value: `${r.processingUnits} PU` },
      { label: "consistency", value: "STRONG" },
    );
  }
  if ("documents" in r) {
    rows.push(
      { label: "source database", value: r.database },
      { label: "location", value: r.location },
      {
        label: "documents",
        value: JSON.stringify(r.documents.map((d) => ({ path: d.path, data: d.data }))),
      },
    );
  }
  if ("instance" in r) {
    rows.push({ label: "instance", value: r.instance });
  }
  if ("tables" in r) {
    rows.push(...r.tables.map((t) => ({ label: `table ${t.name}`, value: JSON.stringify(t) })));
  }
  if ("table" in r) {
    rows.push({ label: "backup table", value: JSON.stringify(r.table) });
  }
  if ("clusters" in r) {
    rows.push(
      { label: "replication version", value: String(r.version) },
      ...r.clusters.map((c) => ({
        label: `cluster ${c.name}`,
        value: `${c.zone} · nodes=${c.nodes} · version=${c.version} · ${c.version === r.version ? "CAUGHT_UP" : "LAGGING"}`,
      })),
    );
  }
  const resource = "instance" in r ? `${r.instance}/${r.name}` : r.name;
  rows.push(
    ...world.managedDatabases.observations
      .filter(
        (o) =>
          o.projectId === r.projectId &&
          (o.resource === resource || o.resource.startsWith(`${resource}/`)),
      )
      .slice(-5)
      .map((o, i) => ({ label: `result ${i + 1}: ${o.operation}`, value: o.result })),
  );
  return <Section title="データ・構成・復旧" rows={rows} />;
};
