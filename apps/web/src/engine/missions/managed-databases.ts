import { cacheOf } from "@/engine/domains/managed-databases/cache";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";

export type ManagedDatabaseLesson =
  | "document"
  | "index"
  | "firestoreRestore"
  | "spanner"
  | "spannerRestore"
  | "bigtableGc"
  | "bigtableReplication"
  | "bigtableRestore"
  | "redisTtl"
  | "redisHa"
  | "functionsFirestore"
  | "functionsRedis"
  | "vector"
  | "selection";
export type ManagedDatabaseAssertion = Readonly<{
  kind: "managedDatabaseLesson";
  lesson: ManagedDatabaseLesson;
}>;
export const ManagedDatabasePrelude = [
  "gcloud services enable firestore.googleapis.com spanner.googleapis.com bigtable.googleapis.com bigtableadmin.googleapis.com redis.googleapis.com compute.googleapis.com vpcaccess.googleapis.com cloudfunctions.googleapis.com run.googleapis.com sqladmin.googleapis.com",
];
const fs = (db: string, location = "us-central1") =>
  `gcloud firestore databases create ${db} --location=${location} --type=firestore-native`;
const doc = (db: string, path: string, value: object) =>
  `sim firestore documents write ${path} --database=${db} --data='${JSON.stringify(value)}'`;
const fsQuery = (db: string) => `sim firestore query orders --database=${db}`;
const spanner = (i: string, config = "regional-us-central1") =>
  `gcloud spanner instances create ${i} --config=${config} --processing-units=1000`;
const spDb = (i: string) =>
  `gcloud spanner databases create app --instance=${i} --ddl='CREATE TABLE orders (id INT64 NOT NULL, note STRING(MAX)) PRIMARY KEY (id)'`;
const spSql = (i: string, sql: string, db = "app") =>
  `sim spanner execute ${db} --instance=${i} --sql="${sql}"`;
const spSeed = (i: string) => [
  spanner(i),
  spDb(i),
  spSql(i, "INSERT INTO orders VALUES (1, 'before')"),
];
const bt = (i: string) =>
  `gcloud bigtable instances create ${i} --cluster=primary --cluster-zone=us-central1-a --cluster-num-nodes=1`;
const table = (i: string) =>
  `sim bigtable tables create readings --instance=${i} --cluster=primary --column-families=data`;
const cell = (i: string, value: string, timestamp = "2026-10-01T10:00:00Z") =>
  `sim bigtable rows write sensor-1 --instance=${i} --cluster=primary --table=readings --family=data --qualifier=value --value=${value} --timestamp=${timestamp}`;
const btRead = (i: string, table = "readings", cluster = "primary") =>
  `sim bigtable rows read sensor-1 --instance=${i} --cluster=${cluster} --table=${table}`;
const redis = (i: string, tier = "BASIC") =>
  `gcloud redis instances create ${i} --region=us-central1 --network=default --size=1 --tier=${tier}`;
const cache = (i: string, operation: string, flags = "") =>
  `sim redis cache ${operation} visits --instance=${i} --region=us-central1 --network=default ${flags}`;
const p = F.devProjectId;
const sa = `database-worker@${p}.iam.gserviceaccount.com`;
const worker = [
  "gcloud iam service-accounts create database-worker",
  `gcloud iam service-accounts add-iam-policy-binding ${sa} --member=user:${F.owner} --role=roles/iam.serviceAccountUser`,
];
const fn = (n: string, flags: string) =>
  `gcloud functions deploy ${n} --region=us-central1 --runtime=nodejs22 --service-account=${sa} --trigger-http ${flags}`;
export const ManagedDatabaseSolutions: Readonly<Record<ManagedDatabaseLesson, readonly string[]>> =
  {
    document: [
      fs("doc-app", "nam5"),
      doc("doc-app", "orders/one", { count: 1 }),
      "sim firestore documents increment orders/one --database=doc-app --field=count --amount=2 --expected-version=1",
      fsQuery("doc-app"),
    ],
    index: [
      fs("index-app"),
      doc("index-app", "orders/one", { tenant: "a", total: 10 }),
      doc("index-app", "orders/two", { tenant: "a", total: 20 }),
      doc("index-app", "orders/three", { tenant: "b", total: 30 }),
      "sim firestore indexes create tenant-total --database=index-app --collection=orders --fields=tenant,total",
      `sim firestore query orders --database=index-app --where-field=tenant --equals='"a"' --order-by=total --descending --limit=2`,
    ],
    firestoreRestore: [
      fs("source-docs"),
      doc("source-docs", "orders/one", { note: "before" }),
      "sim firestore backups create docs-copy --database=source-docs",
      "sim firestore documents delete orders/one --database=source-docs",
      "sim firestore backups restore docs-copy --destination-database=recovered-docs",
      fsQuery("recovered-docs"),
    ],
    spanner: [
      spanner("global-app", "nam3"),
      spDb("global-app"),
      spSql("global-app", "INSERT INTO orders VALUES (1, 'committed')"),
      "gcloud spanner instances update global-app --processing-units=2000",
      spSql("global-app", "SELECT * FROM orders"),
    ],
    spannerRestore: [
      ...spSeed("restore-spanner"),
      "gcloud spanner backups create spanner-copy --instance=restore-spanner --database=app",
      spSql("restore-spanner", "DELETE FROM orders"),
      "gcloud spanner databases restore recovered --instance=restore-spanner --backup=spanner-copy",
      spSql("restore-spanner", "SELECT * FROM orders", "recovered"),
    ],
    bigtableGc: [
      bt("telemetry"),
      table("telemetry"),
      cell("telemetry", "old"),
      cell("telemetry", "latest", "2026-10-01T10:10:00Z"),
      "sim bigtable families set-gc data --instance=telemetry --cluster=primary --table=readings --max-versions=1 --max-age-seconds=3600",
      "sim bigtable gc readings --instance=telemetry --cluster=primary --at=2026-10-01T10:20:00Z",
      btRead("telemetry"),
    ],
    bigtableReplication: [
      bt("replicated"),
      table("replicated"),
      "gcloud bigtable clusters create secondary --instance=replicated --zone=us-central1-b --num-nodes=2",
      cell("replicated", "replicated"),
      "sim bigtable replication advance --instance=replicated",
      btRead("replicated", "readings", "secondary"),
    ],
    bigtableRestore: [
      bt("restore-bigtable"),
      table("restore-bigtable"),
      cell("restore-bigtable", "before"),
      "gcloud bigtable backups create bt-copy --instance=restore-bigtable --cluster=primary --table=readings",
      "sim bigtable rows delete sensor-1 --instance=restore-bigtable --cluster=primary --table=readings --quiet",
      "sim bigtable backups restore bt-copy --instance=restore-bigtable --cluster=primary --table=recovered",
      btRead("restore-bigtable", "recovered"),
    ],
    redisTtl: [
      redis("ttl-cache"),
      cache("ttl-cache", "set", "--value=1 --ttl=10"),
      cache("ttl-cache", "get"),
      "sim databases time advance --seconds=10",
      cache("ttl-cache", "get"),
    ],
    redisHa: [
      redis("ha-cache", "STANDARD_HA"),
      cache("ha-cache", "set", "--value=1"),
      "gcloud redis instances failover ha-cache --region=us-central1",
      cache("ha-cache", "increment"),
      cache("ha-cache", "get"),
    ],
    functionsFirestore: [
      ...worker,
      fs("function-docs"),
      doc("function-docs", "orders/one", { note: "runtime-read" }),
      `gcloud projects add-iam-policy-binding ${p} --member=serviceAccount:${sa} --role=roles/datastore.viewer`,
      fn("document-reader", "--set-env-vars=FIRESTORE_DATABASE=function-docs"),
      "sim functions database read document-reader --region=us-central1 --document=orders/one",
    ],
    functionsRedis: [
      ...worker,
      redis("function-cache"),
      "gcloud compute networks vpc-access connectors create database-connector --region=us-central1 --network=default --range=10.9.0.0/28",
      fn(
        "cache-counter",
        "--vpc-connector=database-connector --set-env-vars=REDIS_INSTANCE=function-cache",
      ),
      "sim functions database increment-cache cache-counter --region=us-central1 --key=visits",
      "sim functions database increment-cache cache-counter --region=us-central1 --key=visits",
    ],
    vector: [
      spanner("vector-spanner"),
      "gcloud spanner databases create app --instance=vector-spanner --ddl='CREATE TABLE items (id INT64 NOT NULL, title STRING(MAX), embedding ARRAY<FLOAT64>) PRIMARY KEY (id)'",
      spSql("vector-spanner", "INSERT INTO items VALUES (1, 'east', [1,0,0])"),
      spSql("vector-spanner", "INSERT INTO items VALUES (2, 'near', [4,1,0])"),
      spSql("vector-spanner", "INSERT INTO items VALUES (3, 'north', [0,1,0])"),
      spSql("vector-spanner", "SELECT id, title FROM items WHERE id = 3"),
      spSql(
        "vector-spanner",
        "SELECT id, title, COSINE_DISTANCE(embedding, [1,0,0]) AS distance FROM items ORDER BY distance LIMIT 2",
      ),
    ],
    selection: [
      "sim databases choose mobile-documents --service=firestore",
      "sim databases choose telemetry --service=bigtable",
      "sim databases choose session-cache --service=redis",
      "sim databases choose global-transactions --service=spanner",
    ],
  };
const definitions: readonly [ManagedDatabaseLesson, string, string][] = [
  [
    "document",
    "Firestoreの整合したドキュメント更新",
    "Native mode・複数リージョンの配置を選び、version付きの単一ドキュメント更新と強整合な照会を確認します。",
  ],
  [
    "index",
    "複合索引でテナントの注文を検索",
    "等価条件と別フィールドのソートに必要な索引を作り、他テナントを含めず上位2件を照会します。",
  ],
  [
    "firestoreRestore",
    "Firestoreの誤削除を別DBへ復元",
    "ドキュメントを保存し、削除後に新しいDBへ復元してデータを照会します。索引はバックアップに含めません。",
  ],
  [
    "spanner",
    "Spannerの構成・容量・主キーを設定",
    "広域トランザクション用構成と2000 PUを選び、GoogleSQLの小さなサブセットで保存・強整合な照会を行います。",
  ],
  [
    "spannerRestore",
    "Spannerのバックアップから別DBへ復元",
    "主キーと保存時点の行を保持したコピーから、削除後に新しいDBへ復元・照会します。",
  ],
  [
    "bigtableGc",
    "Bigtableの列ファミリーとGCを設定",
    "同じセルに2版を書き、版数・保持時間のルールを明示時刻で評価して最新値を読みます。実環境のGCは非同期です。",
  ],
  [
    "bigtableReplication",
    "Bigtableの別クラスタで複製を確認",
    "別ゾーンのクラスタを追加し、更新の複製を明示的に進めてセカンダリから読み取ります。",
  ],
  [
    "bigtableRestore",
    "Bigtableのバックアップを別テーブルへ復元",
    "列ファミリーとセルの保存時点のデータを、同じリージョンの新規テーブルへ復元して読みます。",
  ],
  [
    "redisTtl",
    "Redisのキャッシュ期限を確認",
    "同じVPCから値を読み、仮想時計を10秒進めてTTL後のcache missを確認します。キャッシュは永続DBではありません。",
  ],
  [
    "redisHa",
    "RedisのHA切替後にカウンタを更新",
    "STANDARD_HAを選び、安定した接続先でfailover後のINCRとGETを確認します。実サービスの耐久性は再現しません。",
  ],
  [
    "functionsFirestore",
    "Functionsの実行SAでFirestoreを読む",
    "実行SAにはviewerを与え、固定ハンドラが設定したDBの実データを読み取ることを確認します。",
  ],
  [
    "functionsRedis",
    "FunctionsからVPC経由でキャッシュを更新",
    "同リージョンのconnectorとRedisのVPCをそろえ、固定ハンドラでカウンタを2にします。",
  ],
  [
    "vector",
    "Spannerでキー検索とベクトル距離を比べる",
    "人工3次元データで、idの等価条件とcosine距離の順位が違うことを確認します。AI呼出しやANN・性能測定は行いません。",
  ],
  [
    "selection",
    "データ形・整合性・一時性からDBを選ぶ",
    "ドキュメント、時系列、大域トランザクション、キャッシュの4要件に合うサービスを選びます。",
  ],
];
export const ManagedDatabaseMissions: readonly Mission[] = definitions.map(
  ([lesson, title, description], i) => ({
    id: `m-managed-db-${String(i + 1).padStart(3, "0")}`,
    domain: lesson === "selection" ? "計画と構成" : "運用の維持",
    title,
    description,
    setup: [
      { kind: "setPrincipal", principal: F.owner },
      { kind: "setProject", projectId: p },
    ],
    hints: [...ManagedDatabasePrelude, ...ManagedDatabaseSolutions[lesson]],
    assertions: [{ kind: "managedDatabaseLesson", lesson }],
  }),
);
export const managedDatabaseSatisfied = (world: World, lesson: ManagedDatabaseLesson): boolean => {
  const m = world.managedDatabases;
  const observation = (service: string, resource: string, operation: string) => {
    const o = m.observations
      .filter(
        (o) =>
          o.projectId === p &&
          o.service === service &&
          o.resource === resource &&
          o.operation === operation,
      )
      .at(-1);
    if (!o) {
      return "";
    }
    return o.result;
  };
  const docValue = (database: string) =>
    world.serverlessLab.documents.find(
      (d) => d.projectId === p && d.database === database && d.path === "orders/one",
    );
  const queried = (service: string, resource: string, needle: string, operation = "query") =>
    observation(service, resource, operation).includes(needle);
  const recovery = (service: string, target: string) =>
    m.recoveries.some((r) => r.projectId === p && r.service === service && r.target === target);
  if (lesson === "selection") {
    return [
      "mobile-documents:firestore",
      "telemetry:bigtable",
      "session-cache:redis",
      "global-transactions:spanner",
    ].every((pair) => {
      const [key, value] = pair.split(":");
      return world.relational.decisions[`${p}/${key}`] === value;
    });
  }
  if (lesson === "document") {
    const d = docValue("doc-app");
    return (
      world.serverlessLab.databases.some(
        (d) => d.projectId === p && d.name === "doc-app" && d.region === "nam5",
      ) &&
      d?.version === 2 &&
      d.data === '{"count":3}' &&
      queried("firestore", "doc-app", '"count":3')
    );
  }
  if (lesson === "index") {
    return (
      m.indexes.some(
        (i) =>
          i.projectId === p &&
          i.database === "index-app" &&
          i.collection === "orders" &&
          i.fields.join(",") === "tenant,total",
      ) &&
      world.serverlessLab.documents.filter((d) => d.projectId === p && d.database === "index-app")
        .length === 3 &&
      queried("firestore", "index-app", '"total":20') &&
      queried("firestore", "index-app", '"total":10') &&
      !queried("firestore", "index-app", '"total":30')
    );
  }
  if (lesson === "firestoreRestore") {
    return (
      !docValue("source-docs") &&
      docValue("recovered-docs")?.data === '{"note":"before"}' &&
      recovery("firestore", "recovered-docs") &&
      queried("firestore", "recovered-docs", '"note":"before"')
    );
  }
  if (lesson === "functionsFirestore") {
    return (
      docValue("function-docs")?.data === '{"note":"runtime-read"}' &&
      queried("firestore", "function-docs", sa, "function:document-reader")
    );
  }
  if (lesson === "spanner" || lesson === "spannerRestore" || lesson === "vector") {
    const iName = {
      spanner: "global-app",
      spannerRestore: "restore-spanner",
      vector: "vector-spanner",
    }[lesson];
    const i = m.spannerInstances.find((i) => i.projectId === p && i.name === iName);
    const dbName = lesson === "spannerRestore" ? "recovered" : "app";
    const db = m.spannerDatabases.find(
      (d) => d.projectId === p && d.instance === iName && d.name === dbName,
    );
    const rows = db?.tables[0]?.rows ?? [];
    const resource = `${iName}/${dbName}`;
    if (lesson === "spanner") {
      return (
        i?.config === "nam3" &&
        i.processingUnits === 2000 &&
        rows.some((r) => r.note === "committed") &&
        queried("spanner", resource, '"note":"committed"')
      );
    }
    if (lesson === "spannerRestore") {
      const old = m.spannerDatabases.find(
        (d) => d.projectId === p && d.instance === iName && d.name === "app",
      );
      return (
        old?.tables[0]?.rows.length === 0 &&
        rows.some((r) => r.note === "before") &&
        recovery("spanner", resource) &&
        queried("spanner", resource, '"note":"before"')
      );
    }
    const result = observation("spanner", resource, "query");
    return (
      rows.length === 3 &&
      result.includes('"id":1') &&
      result.includes('"id":2') &&
      !result.includes('"id":3') &&
      result.includes('"distance":0') &&
      m.observations.some(
        (o) =>
          o.projectId === p &&
          o.service === "spanner" &&
          o.resource === resource &&
          o.result.includes('"id":3'),
      )
    );
  }
  if (["bigtableGc", "bigtableReplication", "bigtableRestore"].includes(lesson)) {
    const id = {
      bigtableGc: "telemetry",
      bigtableReplication: "replicated",
      bigtableRestore: "restore-bigtable",
    }[lesson as "bigtableGc" | "bigtableReplication" | "bigtableRestore"];
    const i = m.bigtableInstances.find((i) => i.projectId === p && i.name === id);
    const t = i?.tables.find(
      (t) => t.name === (lesson === "bigtableRestore" ? "recovered" : "readings"),
    );
    if (!i || !t) {
      return false;
    }
    const resource = `${i.name}/${t.name}`;
    if (lesson === "bigtableReplication") {
      return (
        i.clusters.length === 2 &&
        i.clusters.every((c) => c.version === i.version) &&
        t.cells.some((c) => c.value === "replicated") &&
        queried("bigtable", resource, '"value":"replicated"', "read:secondary")
      );
    }
    if (lesson === "bigtableRestore") {
      return (
        i.tables.find((t) => t.name === "readings")?.cells.length === 0 &&
        t.cells.some((c) => c.value === "before") &&
        recovery("bigtable", resource) &&
        queried("bigtable", resource, '"value":"before"', "read:primary")
      );
    }
    return (
      t.cells.length === 1 &&
      t.cells[0]?.value === "latest" &&
      t.families[0]?.maxAgeSeconds === 3600 &&
      queried("bigtable", resource, '"value":"latest"', "read:primary") &&
      m.observations.some(
        (o) =>
          o.projectId === p &&
          o.service === "bigtable" &&
          o.resource === resource &&
          o.operation === "gc" &&
          o.result.includes('"removed":1'),
      )
    );
  }
  const id = { redisTtl: "ttl-cache", redisHa: "ha-cache", functionsRedis: "function-cache" }[
    lesson as "redisTtl" | "redisHa" | "functionsRedis"
  ];
  const r = world.serverlessLab.redis.find(
    (r) => r.projectId === p && r.name === id && r.region === "us-central1",
  );
  if (!r) {
    return false;
  }
  const c = cacheOf(world, r);
  const resource = `${r.region}/${r.name}`;
  if (lesson === "redisTtl") {
    return (
      m.clock >= 10 &&
      !c.entries.some((e) => e.key === "visits") &&
      queried("redis", resource, '"value":null', "get") &&
      m.observations.some(
        (o) =>
          o.projectId === p &&
          o.resource === resource &&
          o.operation === "get" &&
          o.result.includes('"value":"1"'),
      )
    );
  }
  if (lesson === "redisHa") {
    return (
      c.tier === "STANDARD_HA" &&
      c.failovers >= 1 &&
      c.entries.some((e) => e.key === "visits" && e.value === "2") &&
      queried("redis", resource, '"value":"2"', "get")
    );
  }
  return (
    c.entries.some((e) => e.key === "visits" && e.value === "2") &&
    queried("redis", resource, sa, "function:cache-counter")
  );
};
