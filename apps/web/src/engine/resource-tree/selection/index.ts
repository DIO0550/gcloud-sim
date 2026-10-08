import { type Region, Zone } from "@/engine/domains/catalog";
import { LbScope } from "@/engine/domains/load-balancing";
import type { LbResource } from "@/engine/domains/load-balancing/graph";
import type { PolicyTarget } from "@/engine/domains/resource-hierarchy";
import { Option } from "@/utils/Option";

/** ツリーで選べるもの。プロパティパネルはこれを見て World から中身を引く。 */
export type TreeSelection =
  | Readonly<{
      kind: "serverless-lab";
      collection:
        | "deployments"
        | "connectors"
        | "redis"
        | "databases"
        | "secrets"
        | "keys"
        | "triggers"
        | "workflows";
      projectId: string;
      region: string;
      name: string;
      subtype: string;
    }>
  | Readonly<{
      kind: "kube-lesson";
      resourceKind: "serviceaccount" | "vpa";
      projectId: string;
      cluster: string;
      namespace?: string;
      name: string;
    }>
  | Readonly<{
      kind: "container-lab";
      collection: "repositories" | "images" | "containers" | "builds";
      id: string;
    }>
  | Readonly<{
      kind: "observability";
      projectId: string;
      name: string;
      collection: "logMetrics" | "dashboards" | "alertPolicies" | "uptimeChecks";
    }>
  | Readonly<{ kind: "organization" }>
  | Readonly<{ kind: "folder"; id: string }>
  | Readonly<{ kind: "project"; projectId: string }>
  | Readonly<{ kind: "billing"; id: string }>
  | Readonly<{ kind: "budget"; billingAccountId: string; id: string }>
  | Readonly<{ kind: "instance"; projectId: string; zone: Zone; name: string }>
  | Readonly<{ kind: "disk"; projectId: string; zone: Zone; name: string }>
  | Readonly<{ kind: "snapshot"; projectId: string; name: string }>
  | Readonly<{ kind: "instance-template"; projectId: string; name: string }>
  | Readonly<{ kind: "instance-group"; projectId: string; location: Zone | Region; name: string }>
  | Readonly<{ kind: "network"; projectId: string; name: string }>
  | Readonly<{ kind: "subnet"; projectId: string; region: Region; name: string }>
  | Readonly<{ kind: "firewall"; projectId: string; name: string }>
  | Readonly<{ kind: "address"; projectId: string; region: Option<Region>; name: string }>
  | Readonly<{ kind: "router"; projectId: string; region: Region; name: string }>
  | Readonly<{ kind: "health-check"; projectId: string; name: string; scope?: LbScope }>
  | Readonly<{
      kind: "lb-resource";
      projectId: string;
      name: string;
      location: string;
      resourceKind: LbResource["kind"];
    }>
  | Readonly<{ kind: "backend-service"; projectId: string; scope: LbScope; name: string }>
  | Readonly<{ kind: "forwarding-rule"; projectId: string; scope: LbScope; name: string }>
  | Readonly<{ kind: "bucket"; name: string }>
  | Readonly<{ kind: "cluster"; projectId: string; name: string }>
  | Readonly<{ kind: "node-pool"; projectId: string; cluster: string; name: string }>
  | Readonly<{
      kind: "kube-storage";
      resourceKind: "storageclass" | "pvc" | "pv";
      projectId: string;
      cluster: string;
      namespace?: string;
      name: string;
    }>
  | Readonly<{
      kind: "kube-ingress";
      projectId: string;
      cluster: string;
      namespace?: string;
      name: string;
    }>
  | Readonly<{
      kind: "kube-network-policy";
      projectId: string;
      cluster: string;
      namespace?: string;
      name: string;
    }>
  | Readonly<{ kind: "kube-namespace"; projectId: string; cluster: string; name: string }>
  | Readonly<{
      kind: "kube-statefulset";
      projectId: string;
      cluster: string;
      namespace?: string;
      name: string;
    }>
  | Readonly<{
      kind: "kube-deployment";
      projectId: string;
      cluster: string;
      namespace?: string;
      name: string;
    }>
  | Readonly<{
      kind: "kube-config";
      namespace?: string;
      resourceKind: "configmap" | "secret";
      projectId: string;
      cluster: string;
      name: string;
    }>
  | Readonly<{
      kind: "kube-hpa";
      projectId: string;
      cluster: string;
      namespace?: string;
      name: string;
    }>
  | Readonly<{
      kind: "kube-service";
      projectId: string;
      cluster: string;
      namespace?: string;
      name: string;
    }>
  | Readonly<{ kind: "run-service"; projectId: string; region?: string; name: string }>
  | Readonly<{ kind: "function"; projectId: string; region: Region; name: string }>
  | Readonly<{ kind: "app-engine"; projectId: string }>
  | Readonly<{ kind: "app-version"; projectId: string; service: string; id: string }>
  | Readonly<{ kind: "sql-instance"; projectId: string; name: string }>
  | Readonly<{ kind: "topic"; projectId: string; name: string }>
  | Readonly<{ kind: "subscription"; projectId: string; name: string }>
  | Readonly<{ kind: "log-sink"; projectId: string; name: string }>
  | Readonly<{ kind: "key-ring"; projectId: string; location: string; name: string }>
  | Readonly<{ kind: "dns-zone"; projectId: string; name: string }>
  | Readonly<{ kind: "dm-deployment"; projectId: string; name: string }>
  | Readonly<{ kind: "service-account"; email: string }>
  | Readonly<{ kind: "custom-role"; projectId: string; roleId: string }>
  | Readonly<{ kind: "iam"; target: PolicyTarget }>;

/** `--zone=` か `--region=`。MIG とクラスタの置き場はどちらもありうる。 */
const locationFlag = (location: Zone | Region): string =>
  Option.isSome(Zone.parse(location)) ? `--zone=${location}` : `--region=${location}`;

/** `--global` か `--region=`（ロードバランサの部品と予約アドレス）。 */
const scopeFlag = (scope: LbScope): string =>
  scope.kind === "global" ? "--global" : `--region=${scope.region}`;

const iamDescribeCommand = (target: PolicyTarget): string => {
  switch (target.type) {
    case "organization":
      return `gcloud organizations get-iam-policy ${target.id}`;
    case "folder":
      return `gcloud resource-manager folders get-iam-policy ${target.id}`;
    case "project":
      return `gcloud projects get-iam-policy ${target.id}`;
    case "artifact-repository":
      return `gcloud artifacts repositories get-iam-policy ${target.id}`;
    case "bucket":
      return `gcloud storage buckets get-iam-policy gs://${target.id}`;
    case "service-account":
      return `gcloud iam service-accounts get-iam-policy ${target.id}`;
  }
};

export const TreeSelection = {
  /**
   * 2 つの選択が同じものを指しているか。
   *
   * @param a 片方
   * @param b もう片方
   * @returns 種類とキーが同じなら真
   */
  equals(a: TreeSelection, b: TreeSelection): boolean {
    return TreeSelection.key(a) === TreeSelection.key(b);
  },

  /** ツリーのノード id にもなる一意なキー。 */
  key(selection: TreeSelection): string {
    switch (selection.kind) {
      case "serverless-lab":
        return `serverless:${selection.collection}/${selection.projectId}/${selection.region}/${selection.subtype}/${selection.name}`;
      case "container-lab":
        return `container-lab:${selection.collection}:${selection.id}`;
      case "observability":
        return `${selection.collection}:${selection.projectId}/${selection.name}`;
      case "organization":
        return "organization";
      case "folder":
        return `folder:${selection.id}`;
      case "project":
        return `project:${selection.projectId}`;
      case "billing":
        return `billing:${selection.id}`;
      case "budget":
        return `budget:${selection.billingAccountId}/${selection.id}`;
      case "instance":
        return `instance:${selection.projectId}/${selection.zone}/${selection.name}`;
      case "disk":
        return `disk:${selection.projectId}/${selection.zone}/${selection.name}`;
      case "snapshot":
        return `snapshot:${selection.projectId}/${selection.name}`;
      case "instance-template":
        return `template:${selection.projectId}/${selection.name}`;
      case "instance-group":
        return `mig:${selection.projectId}/${selection.location}/${selection.name}`;
      case "network":
        return `network:${selection.projectId}/${selection.name}`;
      case "subnet":
        return `subnet:${selection.projectId}/${selection.region}/${selection.name}`;
      case "firewall":
        return `firewall:${selection.projectId}/${selection.name}`;
      case "address":
        return `address:${selection.projectId}/${Option.unwrapOr(selection.region, "global")}/${selection.name}`;
      case "router":
        return `router:${selection.projectId}/${selection.region}/${selection.name}`;
      case "lb-resource":
        return `lb:${selection.projectId}/${selection.location}/${selection.resourceKind}/${selection.name}`;
      case "health-check":
        return `hc:${selection.projectId}/${LbScope.toPath(selection.scope ?? LbScope.Global)}/${selection.name}`;
      case "backend-service":
        return `bes:${selection.projectId}/${LbScope.toPath(selection.scope)}/${selection.name}`;
      case "forwarding-rule":
        return `fr:${selection.projectId}/${LbScope.toPath(selection.scope)}/${selection.name}`;
      case "bucket":
        return `bucket:${selection.name}`;
      case "cluster":
        return `cluster:${selection.projectId}/${selection.name}`;
      case "node-pool":
        return `pool:${selection.projectId}/${selection.cluster}/${selection.name}`;
      case "kube-ingress":
        return `ing:${selection.projectId}/${selection.cluster}/${selection.namespace ?? "default"}/${selection.name}`;
      case "kube-network-policy":
        return `netpol:${selection.projectId}/${selection.cluster}/${selection.namespace ?? "default"}/${selection.name}`;
      case "kube-storage":
        return `kube-storage:${selection.projectId}/${selection.cluster}/${selection.resourceKind}/${selection.namespace ?? ""}/${selection.name}`;
      case "kube-namespace":
        return `namespace:${selection.projectId}/${selection.cluster}/${selection.name}`;
      case "kube-statefulset":
        return `sts:${selection.projectId}/${selection.cluster}/${selection.namespace ?? "default"}/${selection.name}`;
      case "kube-deployment":
        return `deploy:${selection.projectId}/${selection.cluster}/${selection.namespace && selection.namespace !== "default" ? `${selection.namespace}/` : ""}${selection.name}`;
      case "kube-config":
        return `kube-config:${selection.projectId}/${selection.cluster}/${selection.namespace && selection.namespace !== "default" ? `${selection.namespace}/` : ""}${selection.resourceKind}/${selection.name}`;
      case "kube-lesson":
        return `kube-lesson:${selection.resourceKind}/${selection.projectId}/${selection.cluster}/${selection.namespace ?? "default"}/${selection.name}`;
      case "kube-hpa":
        return `hpa:${selection.projectId}/${selection.cluster}/${selection.namespace && selection.namespace !== "default" ? `${selection.namespace}/` : ""}${selection.name}`;
      case "kube-service":
        return `svc:${selection.projectId}/${selection.cluster}/${selection.namespace && selection.namespace !== "default" ? `${selection.namespace}/` : ""}${selection.name}`;
      case "run-service":
        return `run:${selection.projectId}/${selection.region ?? ""}/${selection.name}`;
      case "function":
        return `function:${selection.projectId}/${selection.region}/${selection.name}`;
      case "app-engine":
        return `app:${selection.projectId}`;
      case "app-version":
        return `version:${selection.projectId}/${selection.service}/${selection.id}`;
      case "sql-instance":
        return `sql:${selection.projectId}/${selection.name}`;
      case "topic":
        return `topic:${selection.projectId}/${selection.name}`;
      case "subscription":
        return `subscription:${selection.projectId}/${selection.name}`;
      case "log-sink":
        return `sink:${selection.projectId}/${selection.name}`;
      case "key-ring":
        return `keyring:${selection.projectId}/${selection.location}/${selection.name}`;
      case "dns-zone":
        return `dns:${selection.projectId}/${selection.name}`;
      case "dm-deployment":
        return `dm:${selection.projectId}/${selection.name}`;
      case "service-account":
        return `sa:${selection.email}`;
      case "custom-role":
        return `role:${selection.projectId}/${selection.roleId}`;
      case "iam":
        return `iam:${selection.target.type}/${selection.target.id}`;
    }
  },

  /**
   * ダブルクリックで入力行に挿入する describe コマンド（UC-007）。
   *
   * @param selection 選択
   * @returns そのリソースを describe するコマンド。組織と App Engine のバージョンには無い
   *   （バージョンは一覧しか持たない）
   */
  describeCommand(selection: TreeSelection): Option<string> {
    switch (selection.kind) {
      case "serverless-lab": {
        const { collection, subtype, name, region, projectId } = selection;
        const prefix = `--project=${projectId}`;
        if (collection === "deployments") {
          const group = { run: "run services", function: "functions", job: "run jobs" };
          return Option.some(
            `gcloud ${group[subtype as keyof typeof group]} describe ${name} --region=${region} ${prefix}`,
          );
        }
        if (collection === "keys") {
          return Option.some(
            `gcloud kms keys describe ${name} --keyring=${subtype} --location=${region} ${prefix}`,
          );
        }
        if (collection === "secrets") {
          return Option.some(`gcloud secrets describe ${name} ${prefix}`);
        }
        const groups = {
          connectors: "compute networks vpc-access connectors",
          redis: "redis instances",
          databases: "firestore databases",
          triggers: "eventarc triggers",
          workflows: "workflows",
        };
        const location =
          collection === "triggers" || collection === "workflows" || collection === "databases"
            ? "location"
            : "region";
        return Option.some(
          `gcloud ${groups[collection]} describe '${name}' --${location}=${region} ${prefix}`,
        );
      }
      case "container-lab":
        if (selection.collection === "builds") return Option.none;
        if (selection.collection === "repositories")
          return Option.some(`gcloud artifacts repositories describe ${selection.id}`);
        if (selection.collection === "containers")
          return Option.some(`docker inspect ${selection.id}`);
        return Option.some("docker images");
      case "observability": {
        const paths = {
          logMetrics: "logging metrics",
          dashboards: "monitoring dashboards",
          alertPolicies: "monitoring policies",
          uptimeChecks: "monitoring uptime",
        };
        return Option.some(
          `gcloud ${paths[selection.collection]} describe ${selection.name} --project=${selection.projectId}`,
        );
      }
      case "organization":
      case "app-version":
        return Option.none;
      case "folder":
        return Option.some(`gcloud resource-manager folders describe ${selection.id}`);
      case "project":
        return Option.some(`gcloud projects describe ${selection.projectId}`);
      case "billing":
        return Option.some(`gcloud billing accounts describe ${selection.id}`);
      case "budget":
        return Option.some(
          `gcloud billing budgets describe ${selection.id} --billing-account=${selection.billingAccountId}`,
        );
      case "instance":
        return Option.some(
          `gcloud compute instances describe ${selection.name} --zone=${selection.zone}`,
        );
      case "disk":
        return Option.some(
          `gcloud compute disks describe ${selection.name} --zone=${selection.zone}`,
        );
      case "snapshot":
        return Option.some(`gcloud compute snapshots describe ${selection.name}`);
      case "instance-template":
        return Option.some(`gcloud compute instance-templates describe ${selection.name}`);
      case "instance-group":
        return Option.some(
          `gcloud compute instance-groups managed describe ${selection.name} ${locationFlag(selection.location)}`,
        );
      case "network":
        return Option.some(`gcloud compute networks describe ${selection.name}`);
      case "subnet":
        return Option.some(
          `gcloud compute networks subnets describe ${selection.name} --region=${selection.region}`,
        );
      case "firewall":
        return Option.some(`gcloud compute firewall-rules describe ${selection.name}`);
      case "address":
        return Option.some(
          `gcloud compute addresses describe ${selection.name} ${Option.isSome(selection.region) ? `--region=${selection.region.value}` : "--global"}`,
        );
      case "router":
        return Option.some(
          `gcloud compute routers describe ${selection.name} --region=${selection.region}`,
        );
      case "lb-resource": {
        const paths = {
          urlMaps: "url-maps",
          targetHttpProxies: "target-http-proxies",
          targetHttpsProxies: "target-https-proxies",
          sslCertificates: "ssl-certificates",
          networkEndpointGroups: "network-endpoint-groups",
          backendBuckets: "backend-buckets",
        };
        const location =
          selection.location === "global"
            ? "--global"
            : `--${selection.location.startsWith("zones/") ? "zone" : "region"}=${selection.location.split("/")[1]}`;
        return Option.some(
          `gcloud compute ${paths[selection.resourceKind]} describe ${selection.name} ${location}`,
        );
      }
      case "health-check":
        return Option.some(
          `gcloud compute health-checks describe ${selection.name} ${scopeFlag(selection.scope ?? LbScope.Global)}`,
        );
      case "backend-service":
        return Option.some(
          `gcloud compute backend-services describe ${selection.name} ${scopeFlag(selection.scope)}`,
        );
      case "forwarding-rule":
        return Option.some(
          `gcloud compute forwarding-rules describe ${selection.name} ${scopeFlag(selection.scope)}`,
        );
      case "bucket":
        return Option.some(`gcloud storage buckets describe gs://${selection.name}`);
      case "cluster":
        return Option.some(`gcloud container clusters describe ${selection.name}`);
      case "node-pool":
        return Option.some(
          `gcloud container node-pools describe ${selection.name} --cluster=${selection.cluster}`,
        );
      case "kube-storage":
        return Option.some(
          `kubectl describe ${selection.resourceKind} ${selection.name}${selection.resourceKind === "pvc" ? ` --namespace=${selection.namespace ?? "default"}` : ""}`,
        );
      case "kube-ingress":
        return Option.some(
          `kubectl describe ing ${selection.name} --namespace=${selection.namespace ?? "default"}`,
        );
      case "kube-network-policy":
        return Option.some(
          `kubectl describe netpol ${selection.name} --namespace=${selection.namespace ?? "default"}`,
        );
      case "kube-namespace":
        return Option.some(`kubectl describe namespace ${selection.name}`);
      case "kube-statefulset":
        return Option.some(
          `kubectl describe statefulset ${selection.name} --namespace=${selection.namespace ?? "default"}`,
        );
      case "kube-deployment":
        return Option.some(
          `kubectl describe deployment ${selection.name} --namespace=${selection.namespace ?? "default"}`,
        );
      case "kube-config":
        return Option.some(
          `kubectl describe ${selection.resourceKind} ${selection.name} --namespace=${selection.namespace ?? "default"}`,
        );
      case "kube-lesson":
        return Option.some(
          `kubectl describe ${selection.resourceKind} ${selection.name} --namespace=${selection.namespace ?? "default"}`,
        );
      case "kube-hpa":
        return Option.some(
          `kubectl describe hpa ${selection.name} --namespace=${selection.namespace ?? "default"}`,
        );
      case "kube-service":
        return Option.some(
          `kubectl describe service ${selection.name} --namespace=${selection.namespace ?? "default"}`,
        );
      case "run-service":
        return Option.some(
          `gcloud run services describe ${selection.name}${selection.region ? ` --region=${selection.region}` : ""}`,
        );
      case "function":
        return Option.some(
          `gcloud functions describe ${selection.name} --region=${selection.region}`,
        );
      case "app-engine":
        return Option.some("gcloud app describe");
      case "sql-instance":
        return Option.some(`gcloud sql instances describe ${selection.name}`);
      case "topic":
        return Option.some(`gcloud pubsub topics describe ${selection.name}`);
      case "subscription":
        return Option.some(`gcloud pubsub subscriptions describe ${selection.name}`);
      case "log-sink":
        return Option.some(`gcloud logging sinks describe ${selection.name}`);
      case "key-ring":
        return Option.some(
          `gcloud kms keyrings describe ${selection.name} --location=${selection.location}`,
        );
      case "dns-zone":
        return Option.some(`gcloud dns managed-zones describe ${selection.name}`);
      case "dm-deployment":
        return Option.some(`gcloud deployment-manager deployments describe ${selection.name}`);
      case "service-account":
        return Option.some(`gcloud iam service-accounts describe ${selection.email}`);
      case "custom-role":
        return Option.some(
          `gcloud iam roles describe ${selection.roleId} --project=${selection.projectId}`,
        );
      case "iam":
        return Option.some(iamDescribeCommand(selection.target));
    }
  },
} as const;
