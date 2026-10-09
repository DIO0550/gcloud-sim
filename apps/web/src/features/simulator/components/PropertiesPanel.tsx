import type { ReactElement } from "react";
import { Pill } from "@/components/Pill";
import { SecondaryButton } from "@/components/SecondaryButton";
import { Instance } from "@/engine/domains/compute";
import { GcloudConfig } from "@/engine/domains/gcloud-config";
import { World } from "@/engine/domains/world";
import { TreeSelection } from "@/engine/resource-tree";
import {
  AddressProperties,
  BackendServiceProperties,
  DiskProperties,
  FirewallProperties,
  ForwardingRuleProperties,
  HealthCheckProperties,
  InstanceGroupProperties,
  InstanceProperties,
  InstanceTemplateProperties,
  NetworkProperties,
  RouterProperties,
  SnapshotProperties,
  SubnetProperties,
} from "@/features/simulator/components/ComputeProperties";
import { ContainerLabProperties } from "@/features/simulator/components/ContainerLabProperties";
import {
  BillingProperties,
  BudgetProperties,
  CustomRoleProperties,
  FolderProperties,
  IamProperties,
  OrganizationProperties,
  ProjectProperties,
  ServiceAccountProperties,
} from "@/features/simulator/components/HierarchyProperties";
import { NetworkPolicyProperties } from "@/features/simulator/components/NetworkPolicyProperties";
import {
  AppEngineProperties,
  AppVersionProperties,
  BucketProperties,
  ClusterProperties,
  DmDeploymentProperties,
  DnsZoneProperties,
  FunctionProperties,
  KeyRingProperties,
  KubeConfigProperties,
  KubeDeploymentProperties,
  KubeHpaProperties,
  KubeNamespaceProperties,
  KubeServiceProperties,
  KubeStorageProperties,
  LogSinkProperties,
  NodePoolProperties,
  ObservabilityProperties,
  RunServiceProperties,
  SqlInstanceProperties,
  SubscriptionProperties,
  TopicProperties,
} from "@/features/simulator/components/ServiceProperties";
import { type ConsoleScreen, ConsoleScreens } from "@/features/simulator/features/console";
import { Option } from "@/utils/Option";
import { GkeLessonProperties } from "./GkeLessonProperties";
import { IngressProperties } from "./IngressProperties";
import { LbResourceProperties } from "./LbResourceProperties";
import { ManagedDatabaseProperties } from "./ManagedDatabaseProperties";
import { RelationalProperties } from "./RelationalProperties";
import { ServerlessProperties } from "./ServerlessProperties";
import { StatefulSetProperties } from "./StatefulSetProperties";

type PropertiesPanelProps = Readonly<{
  world: World;
  selection: Option<TreeSelection>;
  onInsert: (command: string) => void;
  /** 「Console で開く」: Console ビューのその種別の画面へ移る */
  onOpenConsole: (screen: ConsoleScreen) => void;
}>;

const Body = ({
  world,
  selection,
}: Readonly<{ world: World; selection: TreeSelection }>): ReactElement => {
  switch (selection.kind) {
    case "organization":
      return <OrganizationProperties world={world} selection={selection} />;
    case "folder":
      return <FolderProperties world={world} selection={selection} />;
    case "project":
      return <ProjectProperties world={world} selection={selection} />;
    case "billing":
      return <BillingProperties world={world} selection={selection} />;
    case "budget":
      return <BudgetProperties world={world} selection={selection} />;
    case "instance":
      return <InstanceProperties world={world} selection={selection} />;
    case "disk":
      return <DiskProperties world={world} selection={selection} />;
    case "snapshot":
      return <SnapshotProperties world={world} selection={selection} />;
    case "instance-template":
      return <InstanceTemplateProperties world={world} selection={selection} />;
    case "instance-group":
      return <InstanceGroupProperties world={world} selection={selection} />;
    case "network":
      return <NetworkProperties world={world} selection={selection} />;
    case "subnet":
      return <SubnetProperties world={world} selection={selection} />;
    case "firewall":
      return <FirewallProperties world={world} selection={selection} />;
    case "address":
      return <AddressProperties world={world} selection={selection} />;
    case "router":
      return <RouterProperties world={world} selection={selection} />;
    case "lb-resource":
      return <LbResourceProperties world={world} selection={selection} />;
    case "health-check":
      return <HealthCheckProperties world={world} selection={selection} />;
    case "backend-service":
      return <BackendServiceProperties world={world} selection={selection} />;
    case "forwarding-rule":
      return <ForwardingRuleProperties world={world} selection={selection} />;
    case "bucket":
      return <BucketProperties world={world} selection={selection} />;
    case "cluster":
      return <ClusterProperties world={world} selection={selection} />;
    case "node-pool":
      return <NodePoolProperties world={world} selection={selection} />;
    case "kube-ingress":
      return <IngressProperties world={world} selection={selection} />;
    case "kube-network-policy":
      return <NetworkPolicyProperties world={world} selection={selection} />;
    case "kube-storage":
      return <KubeStorageProperties world={world} selection={selection} />;
    case "kube-namespace":
      return <KubeNamespaceProperties world={world} selection={selection} />;
    case "kube-statefulset":
      return <StatefulSetProperties world={world} selection={selection} />;
    case "kube-deployment":
      return <KubeDeploymentProperties world={world} selection={selection} />;
    case "kube-lesson":
      return <GkeLessonProperties world={world} selection={selection} />;
    case "kube-hpa":
      return <KubeHpaProperties world={world} selection={selection} />;
    case "kube-config":
      return <KubeConfigProperties world={world} selection={selection} />;
    case "kube-service":
      return <KubeServiceProperties world={world} selection={selection} />;
    case "managed-database":
      return <ManagedDatabaseProperties world={world} selection={selection} />;
    case "relational":
      return <RelationalProperties world={world} selection={selection} />;
    case "serverless-lab":
      return <ServerlessProperties world={world} selection={selection} />;
    case "run-service":
      return <RunServiceProperties world={world} selection={selection} />;
    case "function":
      return <FunctionProperties world={world} selection={selection} />;
    case "app-engine":
      return <AppEngineProperties world={world} selection={selection} />;
    case "app-version":
      return <AppVersionProperties world={world} selection={selection} />;
    case "sql-instance":
      return <SqlInstanceProperties world={world} selection={selection} />;
    case "topic":
      return <TopicProperties world={world} selection={selection} />;
    case "subscription":
      return <SubscriptionProperties world={world} selection={selection} />;
    case "container-lab":
      return <ContainerLabProperties world={world} selection={selection} />;
    case "observability":
      return <ObservabilityProperties world={world} selection={selection} />;
    case "log-sink":
      return <LogSinkProperties world={world} selection={selection} />;
    case "key-ring":
      return <KeyRingProperties world={world} selection={selection} />;
    case "dns-zone":
      return <DnsZoneProperties world={world} selection={selection} />;
    case "dm-deployment":
      return <DmDeploymentProperties world={world} selection={selection} />;
    case "service-account":
      return <ServiceAccountProperties world={world} selection={selection} />;
    case "custom-role":
      return <CustomRoleProperties world={world} selection={selection} />;
    case "iam":
      return <IamProperties world={world} selection={selection} />;
  }
};

/** 見出し。名前を持つものは名前、持たないものは種別の綴り。 */
const titleOf = (selection: TreeSelection): string => {
  switch (selection.kind) {
    case "managed-database":
    case "relational":
    case "serverless-lab":
      return selection.name;
    case "container-lab":
      return selection.id;
    case "organization":
      return "組織";
    case "folder":
      return `フォルダ ${selection.id}`;
    case "project":
    case "app-engine":
      return selection.projectId;
    case "billing":
    case "budget":
    case "app-version":
      return selection.id;
    case "instance":
    case "disk":
    case "snapshot":
    case "instance-template":
    case "instance-group":
    case "network":
    case "subnet":
    case "firewall":
    case "address":
    case "router":
    case "lb-resource":
    case "health-check":
    case "backend-service":
    case "forwarding-rule":
    case "cluster":
    case "node-pool":
    case "kube-ingress":
    case "kube-network-policy":
    case "kube-storage":
    case "kube-namespace":
    case "kube-statefulset":
    case "kube-deployment":
    case "kube-service":
    case "kube-config":
    case "kube-hpa":
    case "kube-lesson":
    case "run-service":
    case "function":
    case "sql-instance":
    case "topic":
    case "subscription":
    case "observability":
    case "log-sink":
    case "key-ring":
    case "dns-zone":
    case "dm-deployment":
      return selection.name;
    case "bucket":
      return `gs://${selection.name}`;
    case "service-account":
      return selection.email;
    case "custom-role":
      return selection.roleId;
    case "iam":
      return `IAM: ${selection.target.type}/${selection.target.id}`;
  }
};

/** 見出しの下に出す API の種別（`compute#instance` の形）と置き場。 */
const kindLabel = (selection: TreeSelection): string => {
  switch (selection.kind) {
    case "managed-database":
      return `${selection.collection} · projects/${selection.projectId}`;
    case "organization":
      return "cloudresourcemanager#organization";
    case "folder":
      return "cloudresourcemanager#folder";
    case "project":
      return "cloudresourcemanager#project";
    case "billing":
      return "cloudbilling#billingAccount";
    case "budget":
      return `billingbudgets#budget · billingAccounts/${selection.billingAccountId}`;
    case "instance":
      return `compute#instance · projects/${selection.projectId}/zones/${selection.zone}`;
    case "disk":
      return `compute#disk · projects/${selection.projectId}/zones/${selection.zone}`;
    case "snapshot":
      return "compute#snapshot";
    case "instance-template":
      return "compute#instanceTemplate";
    case "instance-group":
      return `compute#instanceGroupManager · ${selection.location}`;
    case "network":
      return "compute#network";
    case "subnet":
      return `compute#subnetwork · regions/${selection.region}`;
    case "firewall":
      return "compute#firewall";
    case "address":
      return `compute#address · ${Option.isSome(selection.region) ? `regions/${selection.region.value}` : "global"}`;
    case "router":
      return `compute#router · regions/${selection.region}`;
    case "lb-resource":
      return `compute#${selection.resourceKind} · ${selection.location}`;
    case "health-check":
      return "compute#healthCheck";
    case "backend-service":
      return "compute#backendService";
    case "forwarding-rule":
      return "compute#forwardingRule";
    case "bucket":
      return "storage#bucket";
    case "cluster":
      return "container#cluster";
    case "node-pool":
      return `container#nodePool · clusters/${selection.cluster}`;
    case "kube-ingress":
      return `networking.k8s.io/v1 Ingress · clusters/${selection.cluster}`;
    case "kube-network-policy":
      return `networking.k8s.io/v1 NetworkPolicy · clusters/${selection.cluster}`;
    case "kube-storage":
      return `${selection.resourceKind === "storageclass" ? "storage.k8s.io/v1 StorageClass" : selection.resourceKind === "pvc" ? "v1 PersistentVolumeClaim" : "v1 PersistentVolume"} · clusters/${selection.cluster}`;
    case "kube-namespace":
      return `v1 Namespace · clusters/${selection.cluster}`;
    case "kube-statefulset":
      return `apps/v1 StatefulSet · clusters/${selection.cluster}`;
    case "kube-deployment":
      return `apps/v1 Deployment · clusters/${selection.cluster}`;
    case "kube-lesson":
      return `${selection.resourceKind === "vpa" ? "autoscaling.k8s.io/v1 VPA" : "v1 ServiceAccount"} · clusters/${selection.cluster}`;
    case "kube-hpa":
      return `autoscaling/v2 HPA · clusters/${selection.cluster}`;
    case "kube-config":
      return `v1 ${selection.resourceKind} · clusters/${selection.cluster}`;
    case "kube-service":
      return `v1 Service · clusters/${selection.cluster}`;
    case "run-service":
      return "run#service";
    case "function":
      return `cloudfunctions#function · locations/${selection.region}`;
    case "app-engine":
      return "appengine#application";
    case "app-version":
      return `appengine#version · services/${selection.service}`;
    case "sql-instance":
      return "sql#instance";
    case "topic":
      return "pubsub#topic";
    case "subscription":
      return "pubsub#subscription";
    case "relational":
      return `${selection.resource} · ${selection.region}`;
    case "serverless-lab":
      return `${selection.collection} · ${selection.region}`;
    case "container-lab":
      return `container-lab#${selection.collection}`;
    case "observability":
      return `observability#${selection.collection}`;
    case "log-sink":
      return "logging#sink";
    case "key-ring":
      return `cloudkms#keyRing · locations/${selection.location}`;
    case "dns-zone":
      return "dns#managedZone";
    case "dm-deployment":
      return "deploymentmanager#deployment";
    case "service-account":
      return "iam#serviceAccount";
    case "custom-role":
      return `iam#role · projects/${selection.projectId}`;
    case "iam":
      return "iam#policy";
  }
};

/** 選んだものを一覧する Console の画面。Console に画面の無い種別は `none`。 */
const consoleScreenOf = (selection: TreeSelection): Option<ConsoleScreen> => {
  switch (selection.kind) {
    case "instance":
      return Option.some(ConsoleScreens.VmList);
    case "firewall":
      return Option.some(ConsoleScreens.Firewall);
    case "subnet":
      return Option.some(ConsoleScreens.Subnets);
    case "bucket":
      return Option.some(ConsoleScreens.Buckets);
    case "cluster":
      return Option.some(ConsoleScreens.Clusters);
    case "run-service":
      return Option.some(ConsoleScreens.RunServices);
    case "service-account":
      return Option.some(ConsoleScreens.ServiceAccounts);
    case "custom-role":
      return Option.some(ConsoleScreens.Roles);
    case "budget":
      return Option.some(ConsoleScreens.Budgets);
    case "iam":
      return Option.some(ConsoleScreens.Iam);
    default:
      return Option.none;
  }
};

/** 作成した時刻（`作成 · 14:02`）。insert のオペレーションが残っているインスタンスだけ。 */
const createdAtOf = (world: World, selection: TreeSelection): Option<string> => {
  if (selection.kind !== "instance") return Option.none;
  return Option.flatMap(
    World.findInstance(world, selection.projectId, selection.zone, selection.name),
    (i) => {
      const insert = World.operationsOfTarget(world, Instance.selfLink(i)).find(
        (o) => o.operationType === "insert",
      );
      return insert === undefined ? Option.none : Option.some(insert.insertTime.slice(11, 16));
    },
  );
};

const statusOf = (world: World, selection: TreeSelection): Option<string> => {
  if (selection.kind !== "instance") return Option.none;
  return Option.map(
    World.findInstance(world, selection.projectId, selection.zone, selection.name),
    (i) => i.status,
  );
};

/** 右ペイン「プロパティ」: 選択したリソースの中身と IAM の継承元（UC-007）。 */
export const PropertiesPanel = ({
  world,
  selection,
  onInsert,
  onOpenConsole,
}: PropertiesPanelProps): ReactElement => {
  if (!Option.isSome(selection)) {
    return (
      <div className="p-5 text-muted text-sm">
        <p>左のリソース階層から項目を選ぶと、ここにプロパティと IAM の継承元が出ます。</p>
        <p className="mt-3">
          現在の configuration:{" "}
          <span className="font-mono">{world.config.activeConfiguration}</span>
          {Option.isSome(GcloudConfig.get(world.config, "compute/zone")) && (
            <>
              {" "}
              · compute/zone:{" "}
              <span className="font-mono">
                {Option.unwrapOr(GcloudConfig.get(world.config, "compute/zone"), "")}
              </span>
            </>
          )}
        </p>
      </div>
    );
  }
  const describe = TreeSelection.describeCommand(selection.value);
  const status = statusOf(world, selection.value);
  const createdAt = createdAtOf(world, selection.value);
  const consoleScreen = consoleScreenOf(selection.value);
  return (
    <div>
      <div className="border-line border-b px-5 pt-5 pb-4">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="min-w-0 break-all font-bold font-mono text-[22px] leading-tight">
            {titleOf(selection.value)}
          </h3>
          {Option.isSome(status) && (
            <Pill
              tone={status.value === "RUNNING" ? "ok" : "muted"}
              className="font-mono font-semibold"
            >
              {status.value}
            </Pill>
          )}
          {Option.isSome(createdAt) && (
            <span className="ml-auto shrink-0 text-sm text-warn-ink">作成 · {createdAt.value}</span>
          )}
        </div>
        <p className="mb-3 break-all font-mono text-[13px] text-muted">
          {kindLabel(selection.value)}
        </p>
        {(Option.isSome(describe) || Option.isSome(consoleScreen)) && (
          <div className="flex flex-wrap gap-2">
            {Option.isSome(describe) && (
              <>
                <SecondaryButton onClick={() => onInsert(describe.value)}>
                  describe を挿入
                </SecondaryButton>
                <SecondaryButton onClick={() => onInsert(`${describe.value} --format=json`)}>
                  JSON
                </SecondaryButton>
              </>
            )}
            {Option.isSome(consoleScreen) && (
              <SecondaryButton onClick={() => onOpenConsole(consoleScreen.value)}>
                Console で開く →
              </SecondaryButton>
            )}
          </div>
        )}
      </div>
      <div className="px-5 pt-4">
        <Body world={world} selection={selection.value} />
      </div>
    </div>
  );
};
