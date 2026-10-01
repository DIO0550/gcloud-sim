import type { ReactElement } from "react";

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
import {
  AppEngineProperties,
  AppVersionProperties,
  BucketProperties,
  ClusterProperties,
  DmDeploymentProperties,
  DnsZoneProperties,
  FunctionProperties,
  KeyRingProperties,
  KubeDeploymentProperties,
  KubeServiceProperties,
  LogSinkProperties,
  NodePoolProperties,
  RunServiceProperties,
  SqlInstanceProperties,
  SubscriptionProperties,
  TopicProperties,
} from "@/features/simulator/components/ServiceProperties";
import { Option } from "@/utils/Option";

type PropertiesPanelProps = Readonly<{
  world: World;
  selection: Option<TreeSelection>;
  onInsert: (command: string) => void;
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
    case "kube-deployment":
      return <KubeDeploymentProperties world={world} selection={selection} />;
    case "kube-service":
      return <KubeServiceProperties world={world} selection={selection} />;
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
    case "health-check":
    case "backend-service":
    case "forwarding-rule":
    case "cluster":
    case "node-pool":
    case "kube-deployment":
    case "kube-service":
    case "run-service":
    case "function":
    case "sql-instance":
    case "topic":
    case "subscription":
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
    case "kube-deployment":
      return `apps/v1 Deployment · clusters/${selection.cluster}`;
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
  return (
    <div className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="font-bold font-mono text-lg">{titleOf(selection.value)}</h3>
        {Option.isSome(status) && (
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-xs ${status.value === "RUNNING" ? "bg-ok-soft text-ok-ink" : "bg-canvas text-muted"}`}
          >
            {status.value}
          </span>
        )}
      </div>
      <p className="mb-3 break-all font-mono text-muted text-xs">{kindLabel(selection.value)}</p>
      {Option.isSome(describe) && (
        <div className="mb-4 flex gap-2">
          <button
            type="button"
            className="rounded border border-line px-3 py-1 text-sm hover:bg-canvas"
            onClick={() => onInsert(describe.value)}
          >
            describe を挿入
          </button>
          <button
            type="button"
            className="rounded border border-line px-3 py-1 text-sm hover:bg-canvas"
            onClick={() => onInsert(`${describe.value} --format=json`)}
          >
            JSON
          </button>
        </div>
      )}
      <Body world={world} selection={selection.value} />
    </div>
  );
};
