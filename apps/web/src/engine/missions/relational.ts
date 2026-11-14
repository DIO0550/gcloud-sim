import { databasesOf, findServer } from "@/engine/domains/relational/model";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";
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
const RelationalPreludeSteps = [
  MissionStep.run(
    "Cloud SQL・AlloyDB・DMSなどのAPIを有効にする",
    "gcloud services enable sqladmin.googleapis.com alloydb.googleapis.com datamigration.googleapis.com compute.googleapis.com storage.googleapis.com",
  ),
];
export const RelationalPrelude = MissionStep.lines(RelationalPreludeSteps);
const sql = (name: string, flags = "") =>
  `gcloud sql instances create ${name} --region=us-central1 --database-version=POSTGRES_16 ${flags}`;
const db = (name: string) => `gcloud sql databases create app --instance=${name}`;
const query = (name: string, text: string) =>
  `sim sql execute ${name} --database=app --sql="${text}"`;
const seed = (name: string) => [
  MissionStep.run("appデータベースを作る", db(name)),
  MissionStep.run(
    "ordersテーブルを作って1行入れる",
    query(
      name,
      "CREATE TABLE orders (id integer PRIMARY KEY, note text NOT NULL); INSERT INTO orders VALUES (1, 'before')",
    ),
  ),
];
const read = (name: string) => query(name, "SELECT * FROM orders");
const cluster = (name: string) =>
  `gcloud alloydb clusters create ${name} --region=us-central1 --network=default`;
const primary = (name: string) =>
  `gcloud alloydb instances create primary --cluster=${name} --region=us-central1 --instance-type=PRIMARY`;
const alloyQuery = (name: string, text: string, instance = "primary") =>
  `sim alloydb execute --cluster=${name} --region=us-central1 --instance=${instance} --network=default --database=app --sql="${text}"`;
/** AlloyDB のクラスタ・primary・テーブルを用意する 4 手順。 */
const alloySeed = (name: string) => [
  MissionStep.run("defaultネットワークにAlloyDBクラスタを作る", cluster(name)),
  MissionStep.run("書き込み用のprimaryインスタンスを作る", primary(name)),
  MissionStep.run(
    "appデータベースを作る",
    `sim alloydb databases create app --cluster=${name} --region=us-central1`,
  ),
  MissionStep.run(
    "primaryでordersテーブルを作って1行入れる",
    alloyQuery(
      name,
      "CREATE TABLE orders (id integer PRIMARY KEY, note text); INSERT INTO orders VALUES (1, 'before')",
    ),
  ),
];
const RelationalSteps: Readonly<Record<RelationalLesson, readonly MissionStep[]>> = {
  transaction: [
    MissionStep.run("PostgreSQL 16のCloud SQLインスタンスを作る", sql("transaction-db")),
    ...seed("transaction-db"),
    MissionStep.run(
      "1つのトランザクションで更新と追加をまとめてコミットする",
      query(
        "transaction-db",
        "BEGIN; UPDATE orders SET note = 'committed' WHERE id = 1; INSERT INTO orders VALUES (2, 'second'); COMMIT",
      ),
      "途中で失敗すると、どちらの変更も残りません。",
    ),
    MissionStep.run("コミット後の2行を照会する", read("transaction-db")),
  ],
  ha: [
    MissionStep.run(
      "private IPだけのREGIONAL構成でインスタンスを作る",
      sql(
        "ha-db",
        "--tier=db-custom-2-7680 --availability-type=regional --network=default --no-assign-ip",
      ),
      "--availability-type=regionalで別ゾーンにスタンバイを置き、--no-assign-ipでpublic IPを付けません。",
    ),
    MissionStep.run("appデータベースを作る", db("ha-db")),
    MissionStep.run(
      "private接続でordersテーブルを作って1行入れる",
      "sim sql execute ha-db --database=app --via=private --network=default --sql=\"CREATE TABLE orders (id integer PRIMARY KEY, note text); INSERT INTO orders VALUES (1, 'before')\"",
    ),
    MissionStep.run("スタンバイへフェイルオーバーする", "gcloud sql instances failover ha-db"),
    MissionStep.run(
      "切替後も同じデータを読めることを確かめる",
      "sim sql execute ha-db --database=app --via=private --network=default --sql='SELECT * FROM orders'",
    ),
  ],
  replica: [
    MissionStep.run("primaryになるインスタンスを作る", sql("primary-db")),
    ...seed("primary-db"),
    MissionStep.run(
      "primary-dbのread replicaを作る",
      sql("reader-db", "--master-instance-name=primary-db"),
    ),
    MissionStep.run(
      "primaryで行を更新する",
      query("primary-db", "UPDATE orders SET note = 'replicated' WHERE id = 1"),
    ),
    MissionStep.run(
      "replicaで更新が反映されたことを照会する",
      read("reader-db"),
      "replicaは読み取り専用で、書き込みはprimaryにしかできません。",
    ),
  ],
  restore: [
    MissionStep.run("Cloud SQLインスタンスを作る", sql("restore-db")),
    ...seed("restore-db"),
    MissionStep.run(
      "オンデマンドバックアップを取る",
      "gcloud sql backups create --instance=restore-db",
    ),
    MissionStep.run(
      "取ったバックアップのIDを一覧で確かめる",
      "gcloud sql backups list --instance=restore-db",
    ),
    MissionStep.run("誤って全行を削除する", query("restore-db", "DELETE FROM orders")),
    MissionStep.run(
      "バックアップを同じインスタンスへ復元する",
      "gcloud sql backups restore BACKUP_ID --backup-instance=restore-db --restore-instance=restore-db --quiet",
      "BACKUP_IDには、gcloud sql backups list --instance=restore-dbで確かめたIDを入れます。",
    ),
    MissionStep.run("行が戻ったことを照会する", read("restore-db")),
  ],
  pitr: [
    MissionStep.run(
      "時点復旧を有効にしてインスタンスを作る",
      sql("pitr-db", "--enable-point-in-time-recovery"),
    ),
    ...seed("pitr-db"),
    MissionStep.run(
      "10:00の状態を記録する",
      "sim sql checkpoint pitr-db --timestamp=2026-10-01T10:00:00Z",
      "timestampは教材内の仮想時刻で、明示して指定します。",
    ),
    MissionStep.run("誤って全行を削除する", query("pitr-db", "DELETE FROM orders")),
    MissionStep.run(
      "削除後の10:10の状態を記録する",
      "sim sql checkpoint pitr-db --timestamp=2026-10-01T10:10:00Z",
    ),
    MissionStep.run(
      "削除前の10:05時点を新しいインスタンスへ複製する",
      "gcloud sql instances clone pitr-db recovered-db --point-in-time=2026-10-01T10:05:00Z",
      "時点復旧は元のインスタンスを巻き戻さず、新しいインスタンスを作ります。",
    ),
    MissionStep.run("復元先で行が戻ったことを照会する", read("recovered-db")),
  ],
  transfer: [
    MissionStep.run("移す元のインスタンスを作る", sql("export-db")),
    ...seed("export-db"),
    MissionStep.run(
      "exportファイルを置くバケットを作る",
      "gcloud storage buckets create gs://lesson-db-export --location=us-central1",
    ),
    MissionStep.run(
      "データベースをSQLファイルとしてバケットへexportする",
      "gcloud sql export sql export-db gs://lesson-db-export/app.sql",
    ),
    MissionStep.run("取り込み先のインスタンスを作る", sql("import-db")),
    MissionStep.run(
      "SQLファイルを取り込み先へimportする",
      "gcloud sql import sql import-db gs://lesson-db-export/app.sql --quiet",
    ),
    MissionStep.run("取り込んだ行を照会する", read("import-db")),
  ],
  alloy: [
    ...alloySeed("alloy-app"),
    MissionStep.run(
      "2ノードのread poolを追加する",
      "gcloud alloydb instances create readers --cluster=alloy-app --region=us-central1 --instance-type=READ_POOL --read-pool-node-count=2",
    ),
    MissionStep.run(
      "read poolから行を照会する",
      alloyQuery("alloy-app", "SELECT * FROM orders", "readers"),
    ),
  ],
  alloyRestore: [
    ...alloySeed("alloy-source"),
    MissionStep.run(
      "クラスタのバックアップを取る",
      "gcloud alloydb backups create alloy-copy --cluster=alloy-source --region=us-central1",
    ),
    MissionStep.run("誤って全行を削除する", alloyQuery("alloy-source", "DELETE FROM orders")),
    MissionStep.run(
      "バックアップを新しいクラスタalloy-recoveredへ復元する",
      "gcloud alloydb clusters restore alloy-recovered --region=us-central1 --network=default --backup=alloy-copy",
    ),
    MissionStep.run(
      "復元したクラスタにprimaryを作る",
      primary("alloy-recovered"),
      "復元したクラスタにはインスタンスが無いので、照会の前にprimaryを作ります。",
    ),
    MissionStep.run(
      "復元先で行が戻ったことを照会する",
      alloyQuery("alloy-recovered", "SELECT * FROM orders"),
    ),
  ],
  migration: [
    MissionStep.run("移行元のインスタンスを作る", sql("migration-source", "--network=default")),
    ...seed("migration-source"),
    MissionStep.run("移行先のインスタンスを作る", sql("migration-target", "--network=default")),
    MissionStep.run(
      "移行元の接続プロファイルを作る",
      "gcloud database-migration connection-profiles create source-profile --region=us-central1 --instance=migration-source --network=default",
    ),
    MissionStep.run(
      "移行先の接続プロファイルを作る",
      "gcloud database-migration connection-profiles create target-profile --region=us-central1 --instance=migration-target --network=default",
    ),
    MissionStep.run(
      "2つのプロファイルをつなぐ移行ジョブを作る",
      "gcloud database-migration migration-jobs create move-app --region=us-central1 --source=source-profile --destination=target-profile",
    ),
    MissionStep.run(
      "移行ジョブの接続を検証する",
      "gcloud database-migration migration-jobs verify move-app --region=us-central1",
      "検証していないジョブはstartできません。",
    ),
    MissionStep.run(
      "移行ジョブを開始する",
      "gcloud database-migration migration-jobs start move-app --region=us-central1",
      "開始すると、移行先は切り替えまで書き込めなくなります。",
    ),
    MissionStep.run("初期コピーを進める", "sim dms advance move-app --region=us-central1"),
    MissionStep.run(
      "移行元で行を更新する",
      query("migration-source", "UPDATE orders SET note = 'after' WHERE id = 1"),
    ),
    MissionStep.run(
      "移行元への書き込みを止める",
      "sim sql writes pause migration-source",
      "切り替え前に書き込みを止め、更新の取りこぼしを防ぎます。",
    ),
    MissionStep.run(
      "止める前の更新を移行先へ追従させる",
      "sim dms advance move-app --region=us-central1",
    ),
    MissionStep.run(
      "移行先を昇格して切り替える",
      "gcloud database-migration migration-jobs promote move-app --region=us-central1",
    ),
    MissionStep.run(
      "昇格した移行先に行を追加する",
      query("migration-target", "INSERT INTO orders VALUES (2, 'new-owner')"),
    ),
    MissionStep.run("移行先の行を照会する", read("migration-target")),
  ],
  vector: [
    MissionStep.run("Cloud SQLインスタンスを作る", sql("vector-db")),
    MissionStep.run("appデータベースを作る", db("vector-db")),
    MissionStep.run(
      "pgvector拡張とitemsテーブルを作って3行入れる",
      query(
        "vector-db",
        "CREATE EXTENSION vector; CREATE TABLE items (id integer PRIMARY KEY, title text, tenant text, embedding vector(3)); INSERT INTO items VALUES (1, 'east', 'a', '[1,0,0]'); INSERT INTO items VALUES (2, 'near', 'a', '[4,1,0]'); INSERT INTO items VALUES (3, 'north', 'b', '[0,1,0]')",
      ),
    ),
    MissionStep.run(
      "idの等価条件で1行を照会する",
      query("vector-db", "SELECT id, title FROM items WHERE id = 3"),
    ),
    MissionStep.run(
      "テナントaの中で[1,0,0]に近い順に2件照会する",
      query(
        "vector-db",
        "SELECT id, title, embedding <=> '[1,0,0]'::vector AS distance FROM items WHERE tenant = 'a' ORDER BY distance LIMIT 2",
      ),
      "<=>はcosine距離の演算子です。",
    ),
  ],
  selection: [
    MissionStep.run(
      "既存MySQLの移行先にCloud SQLを選ぶ",
      "sim databases choose existing-mysql --service=cloud-sql",
    ),
    MissionStep.run(
      "大域トランザクションにSpannerを選ぶ",
      "sim databases choose global-transactions --service=spanner",
    ),
    MissionStep.run(
      "集計分析のデータ倉庫にBigQueryを選ぶ",
      "sim databases choose warehouse --service=bigquery",
    ),
  ],
};
/** 各レッスンの解答を端末の行だけで並べたもの（テストがそのまま流す）。 */
export const RelationalSolutions = Object.fromEntries(
  Object.entries(RelationalSteps).map(([lesson, steps]) => [lesson, MissionStep.lines(steps)]),
) as Readonly<Record<RelationalLesson, readonly string[]>>;
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
    steps: [...RelationalPreludeSteps, ...RelationalSteps[lesson]],
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
