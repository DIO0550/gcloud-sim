import { databasesOf, findServer } from "@/engine/domains/relational/model";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
export type RelationalLesson =
  | "transaction"
  | "ha"
  | "replica"
  | "restore"
  | "pitr"
  | "transfer"
  | "alloy"
  | "alloyRestore"
  | "migration"
  | "vector"
  | "selection";
export type RelationalAssertion = Readonly<{ kind: "relationalLesson"; lesson: RelationalLesson }>;
export const RelationalPrelude = [
  "gcloud services enable sqladmin.googleapis.com alloydb.googleapis.com datamigration.googleapis.com compute.googleapis.com storage.googleapis.com",
];
const sql = (name: string, flags = "") =>
  `gcloud sql instances create ${name} --region=us-central1 --database-version=POSTGRES_16 ${flags}`;
const db = (name: string) => `gcloud sql databases create app --instance=${name}`;
const query = (name: string, text: string) =>
  `sim sql execute ${name} --database=app --sql="${text}"`;
const seed = (name: string) => [
  db(name),
  query(
    name,
    "CREATE TABLE orders (id integer PRIMARY KEY, note text NOT NULL); INSERT INTO orders VALUES (1, 'before')",
  ),
];
const read = (name: string) => query(name, "SELECT * FROM orders");
const cluster = (name: string) =>
  `gcloud alloydb clusters create ${name} --region=us-central1 --network=default`;
const primary = (name: string) =>
  `gcloud alloydb instances create primary --cluster=${name} --region=us-central1 --instance-type=PRIMARY`;
const alloyQuery = (name: string, text: string, instance = "primary") =>
  `sim alloydb execute --cluster=${name} --region=us-central1 --instance=${instance} --network=default --database=app --sql="${text}"`;
export const RelationalSolutions: Readonly<Record<RelationalLesson, readonly string[]>> = {
  transaction: [
    sql("transaction-db"),
    ...seed("transaction-db"),
    query(
      "transaction-db",
      "BEGIN; UPDATE orders SET note = 'committed' WHERE id = 1; INSERT INTO orders VALUES (2, 'second'); COMMIT",
    ),
    read("transaction-db"),
  ],
  ha: [
    sql(
      "ha-db",
      "--tier=db-custom-2-7680 --availability-type=regional --network=default --no-assign-ip",
    ),
    db("ha-db"),
    "sim sql execute ha-db --database=app --via=private --network=default --sql=\"CREATE TABLE orders (id integer PRIMARY KEY, note text); INSERT INTO orders VALUES (1, 'before')\"",
    "gcloud sql instances failover ha-db",
    "sim sql execute ha-db --database=app --via=private --network=default --sql='SELECT * FROM orders'",
  ],
  replica: [
    sql("primary-db"),
    ...seed("primary-db"),
    sql("reader-db", "--master-instance-name=primary-db"),
    query("primary-db", "UPDATE orders SET note = 'replicated' WHERE id = 1"),
    read("reader-db"),
  ],
  restore: [
    sql("restore-db"),
    ...seed("restore-db"),
    "gcloud sql backups create --instance=restore-db",
    query("restore-db", "DELETE FROM orders"),
    "gcloud sql backups restore BACKUP_ID --backup-instance=restore-db --restore-instance=restore-db --quiet",
    read("restore-db"),
  ],
  pitr: [
    sql("pitr-db", "--enable-point-in-time-recovery"),
    ...seed("pitr-db"),
    "sim sql checkpoint pitr-db --timestamp=2026-10-01T10:00:00Z",
    query("pitr-db", "DELETE FROM orders"),
    "sim sql checkpoint pitr-db --timestamp=2026-10-01T10:10:00Z",
    "gcloud sql instances clone pitr-db recovered-db --point-in-time=2026-10-01T10:05:00Z",
    read("recovered-db"),
  ],
  transfer: [
    sql("export-db"),
    ...seed("export-db"),
    "gcloud storage buckets create gs://lesson-db-export --location=us-central1",
    "gcloud sql export sql export-db gs://lesson-db-export/app.sql",
    sql("import-db"),
    "gcloud sql import sql import-db gs://lesson-db-export/app.sql --quiet",
    read("import-db"),
  ],
  alloy: [
    cluster("alloy-app"),
    primary("alloy-app"),
    "sim alloydb databases create app --cluster=alloy-app --region=us-central1",
    alloyQuery(
      "alloy-app",
      "CREATE TABLE orders (id integer PRIMARY KEY, note text); INSERT INTO orders VALUES (1, 'before')",
    ),
    "gcloud alloydb instances create readers --cluster=alloy-app --region=us-central1 --instance-type=READ_POOL --read-pool-node-count=2",
    alloyQuery("alloy-app", "SELECT * FROM orders", "readers"),
  ],
  alloyRestore: [
    cluster("alloy-source"),
    primary("alloy-source"),
    "sim alloydb databases create app --cluster=alloy-source --region=us-central1",
    alloyQuery(
      "alloy-source",
      "CREATE TABLE orders (id integer PRIMARY KEY, note text); INSERT INTO orders VALUES (1, 'before')",
    ),
    "gcloud alloydb backups create alloy-copy --cluster=alloy-source --region=us-central1",
    alloyQuery("alloy-source", "DELETE FROM orders"),
    "gcloud alloydb clusters restore alloy-recovered --region=us-central1 --network=default --backup=alloy-copy",
    primary("alloy-recovered"),
    alloyQuery("alloy-recovered", "SELECT * FROM orders"),
  ],
  migration: [
    sql("migration-source", "--network=default"),
    ...seed("migration-source"),
    sql("migration-target", "--network=default"),
    "gcloud database-migration connection-profiles create source-profile --region=us-central1 --instance=migration-source --network=default",
    "gcloud database-migration connection-profiles create target-profile --region=us-central1 --instance=migration-target --network=default",
    "gcloud database-migration migration-jobs create move-app --region=us-central1 --source=source-profile --destination=target-profile",
    "gcloud database-migration migration-jobs verify move-app --region=us-central1",
    "gcloud database-migration migration-jobs start move-app --region=us-central1",
    "sim dms advance move-app --region=us-central1",
    query("migration-source", "UPDATE orders SET note = 'after' WHERE id = 1"),
    "sim sql writes pause migration-source",
    "sim dms advance move-app --region=us-central1",
    "gcloud database-migration migration-jobs promote move-app --region=us-central1",
    query("migration-target", "INSERT INTO orders VALUES (2, 'new-owner')"),
    read("migration-target"),
  ],
  vector: [
    sql("vector-db"),
    db("vector-db"),
    query(
      "vector-db",
      "CREATE EXTENSION vector; CREATE TABLE items (id integer PRIMARY KEY, title text, tenant text, embedding vector(3)); INSERT INTO items VALUES (1, 'east', 'a', '[1,0,0]'); INSERT INTO items VALUES (2, 'near', 'a', '[4,1,0]'); INSERT INTO items VALUES (3, 'north', 'b', '[0,1,0]')",
    ),
    query("vector-db", "SELECT id, title FROM items WHERE id = 3"),
    query(
      "vector-db",
      "SELECT id, title, embedding <=> '[1,0,0]'::vector AS distance FROM items WHERE tenant = 'a' ORDER BY distance LIMIT 2",
    ),
  ],
  selection: [
    "sim databases choose existing-mysql --service=cloud-sql",
    "sim databases choose global-transactions --service=spanner",
    "sim databases choose warehouse --service=bigquery",
  ],
};
const definitions: readonly [RelationalLesson, string, string][] = [
  [
    "transaction",
    "トランザクションで注文を更新する",
    "既存SQLエンジンの業務DBに2行を保存し、COMMIT後の結果を照会します。未対応SQLは明示的に拒否します。",
  ],
  [
    "ha",
    "private IPのHA構成を切り替える",
    "専用tier・REGIONAL・private接続を構成し、failover後も同じデータを照会します。HAは誤削除からの復旧ではありません。",
  ],
  [
    "replica",
    "read replicaで更新を読み取る",
    "primaryへの変更をreplicaへ反映し、replicaで照会します。replicaは書き込みの水平分散ではありません。",
  ],
  [
    "restore",
    "バックアップから誤削除を復元する",
    "削除前のデータをバックアップし、所属を指定して復元後に照会します。",
  ],
  [
    "pitr",
    "時点復旧で別インスタンスを作る",
    "明示した仮想時刻のcheckpointを2件記録し、誤削除前の時点を新しいインスタンスへ復元します。",
  ],
  [
    "transfer",
    "Storageを経由してSQLデータを移す",
    "実データ入りの教材exportを既存bucketへ保存し、別インスタンスでimport・照会します。",
  ],
  [
    "alloy",
    "AlloyDBのprimaryとread poolを分ける",
    "private VPC上のprimaryで保存し、2ノードのread poolで照会します。実性能は測定しません。",
  ],
  [
    "alloyRestore",
    "AlloyDBのbackupを別clusterへ復元する",
    "バックアップ時のデータを新規clusterへ戻し、primaryを用意して照会します。",
  ],
  [
    "migration",
    "DMSの初期コピー・CDC・切替を確認する",
    "接続testから初期コピー、更新追従、sourceの書き込み停止、promoteまで進め、移行先へ追加して確認します。",
  ],
  [
    "vector",
    "属性検索とベクトル距離を比べる",
    "3次元の人工データで通常の等価検索とcosine距離の順位を比較します。tenant条件を残し、埋め込み生成とは区別します。",
  ],
  [
    "selection",
    "業務DB・広域トランザクション・分析を選ぶ",
    "既存MySQLの互換性、広域の整合性、集計分析という要件にサービスを対応させます。",
  ],
];
export const RelationalMissions: readonly Mission[] = definitions.map(
  ([lesson, title, description], i) => ({
    id: `m-relational-${String(i + 1).padStart(3, "0")}`,
    domain: i === 10 ? "計画と構成" : "運用の維持",
    title,
    description,
    setup: [
      { kind: "setPrincipal", principal: F.owner },
      { kind: "setProject", projectId: F.devProjectId },
    ],
    hints: [
      ...RelationalPrelude,
      ...RelationalSolutions[lesson],
      "BACKUP_IDはgcloud sql backups list --instance=restore-dbのID。PITRのtimestampは明示する教材内の仮想時刻です。",
    ],
    assertions: [{ kind: "relationalLesson", lesson }],
  }),
);
export const relationalSatisfied = (world: World, lesson: RelationalLesson): boolean => {
  const p = F.devProjectId;
  const s = (name: string, kind: "sql" | "alloy" = "sql") =>
    findServer(world, { projectId: p, kind, name });
  const rows = (name: string, kind: "sql" | "alloy" = "sql", table = "orders") => {
    const server = s(name, kind);
    return server
      ? (databasesOf(world, server)
          .find((d) => d.name === "app")
          ?.tables.find((t) => t.name === table)?.rows ?? [])
      : [];
  };
  const queried = (name: string, note: string, kind: "sql" | "alloy" = "sql") =>
    world.relational.queries.some(
      (q) =>
        q.projectId === p &&
        q.kind === kind &&
        q.server === name &&
        q.database === "app" &&
        q.rows.some((row) => row.note === note),
    );
  if (lesson === "selection") {
    return ["existing-mysql:cloud-sql", "global-transactions:spanner", "warehouse:bigquery"].every(
      (v) => {
        const [key, value] = v.split(":");
        return world.relational.decisions[`${p}/${key}`] === value;
      },
    );
  }
  const recovery = (target: string, type: string) =>
    world.relational.recoveries.some(
      (r) => r.projectId === p && r.target === target && r.type === type,
    );
  if (lesson === "transaction") {
    return (
      world.relational.queries.some(
        (q) => q.projectId === p && q.server === "transaction-db" && q.transaction === "COMMIT",
      ) &&
      rows("transaction-db").length === 2 &&
      rows("transaction-db")[0]?.note === "committed" &&
      queried("transaction-db", "second")
    );
  }
  if (lesson === "ha") {
    const server = s("ha-db");
    return Boolean(
      server?.availability === "REGIONAL" &&
        server.failovers > 0 &&
        server.network === "default" &&
        !server.publicIp &&
        rows("ha-db")[0]?.note === "before" &&
        queried("ha-db", "before"),
    );
  }
  if (lesson === "replica") {
    return (
      s("reader-db")?.master === "primary-db" &&
      rows("reader-db")[0]?.note === "replicated" &&
      queried("reader-db", "replicated")
    );
  }
  if (lesson === "restore") {
    return (
      recovery("restore-db", "BACKUP") &&
      world.relational.copies.some(
        (c) => c.projectId === p && c.source === "restore-db" && c.type === "BACKUP",
      ) &&
      rows("restore-db")[0]?.note === "before" &&
      queried("restore-db", "before")
    );
  }
  if (lesson === "pitr") {
    return (
      recovery("recovered-db", "POINT") &&
      s("pitr-db")?.pitr === true &&
      world.relational.copies.filter(
        (c) => c.projectId === p && c.source === "pitr-db" && c.type === "POINT",
      ).length >= 2 &&
      rows("pitr-db").length === 0 &&
      rows("recovered-db")[0]?.note === "before" &&
      queried("recovered-db", "before")
    );
  }
  if (lesson === "transfer") {
    return (
      recovery("import-db", "IMPORT") &&
      world.relational.copies.some(
        (c) =>
          c.projectId === p && c.name === "gs://lesson-db-export/app.sql" && c.type === "EXPORT",
      ) &&
      rows("import-db")[0]?.note === "before" &&
      queried("import-db", "before")
    );
  }
  if (lesson === "alloy") {
    return (
      world.relational.alloyInstances.some(
        (i) =>
          i.projectId === p && i.cluster === "alloy-app" && i.type === "READ_POOL" && i.nodes === 2,
      ) &&
      rows("alloy-app", "alloy")[0]?.note === "before" &&
      world.relational.queries.some(
        (q) =>
          q.projectId === p &&
          q.server === "alloy-app" &&
          q.endpoint === "readers" &&
          q.rows.some((row) => row.note === "before"),
      )
    );
  }
  if (lesson === "alloyRestore") {
    return (
      recovery("alloy-recovered", "BACKUP") &&
      rows("alloy-source", "alloy").length === 0 &&
      rows("alloy-recovered", "alloy")[0]?.note === "before" &&
      queried("alloy-recovered", "before", "alloy")
    );
  }
  if (lesson === "migration") {
    return (
      world.relational.migrations.some(
        (j) =>
          j.projectId === p && j.name === "move-app" && j.state === "COMPLETED" && j.copies >= 2,
      ) &&
      s("migration-source")?.frozen === true &&
      rows("migration-target").length === 2 &&
      rows("migration-target")[0]?.note === "after" &&
      queried("migration-target", "new-owner")
    );
  }
  const vectorRows = rows("vector-db", "sql", "items");
  const plain = world.relational.queries.some(
    (q) =>
      q.projectId === p && q.server === "vector-db" && q.rows.length === 1 && q.rows[0]?.id === 3,
  );
  const ranked = world.relational.queries.some(
    (q) =>
      q.projectId === p &&
      q.server === "vector-db" &&
      q.rows.length === 2 &&
      q.rows[0]?.id === 1 &&
      q.rows[0]?.distance === 0 &&
      q.rows[1]?.id === 2 &&
      typeof q.rows[1]?.distance === "number" &&
      q.rows[1].distance < 0.04,
  );
  return vectorRows.length === 3 && plain && ranked;
};
