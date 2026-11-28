import type { ReactElement } from "react";
import { ApisServicesScreen } from "@/features/simulator/features/console/components/ApisScreens";
import { BudgetsScreen } from "@/features/simulator/features/console/components/BillingScreens";
import { ComputeResourceScreen } from "@/features/simulator/features/console/components/ComputeResourceScreen";
import {
  VmCreateScreen,
  VmListScreen,
} from "@/features/simulator/features/console/components/ComputeScreens";
import {
  ClustersScreen,
  RunServicesScreen,
} from "@/features/simulator/features/console/components/ContainerScreens";
import {
  IamScreen,
  RolesScreen,
  ServiceAccountsScreen,
} from "@/features/simulator/features/console/components/IamScreens";
import { InstanceTemplateCreateScreen } from "@/features/simulator/features/console/components/InstanceTemplateCreateScreen";
import {
  MarketplaceScreen,
  SolutionDeploymentsScreen,
} from "@/features/simulator/features/console/components/MarketplaceScreens";
import {
  CloudNatScreen,
  CloudRoutersScreen,
} from "@/features/simulator/features/console/components/NetworkServicesScreens";
import { BucketsScreen } from "@/features/simulator/features/console/components/StorageScreens";
import {
  FirewallScreen,
  IpAddressesScreen,
  SubnetsScreen,
  VpcNetworksScreen,
  VpcPeeringsScreen,
} from "@/features/simulator/features/console/components/VpcScreens";
import type { ConsoleScreen } from "@/features/simulator/features/console/domains/console-screen";
import type { ScreenProps } from "@/features/simulator/features/console/types/screen-props";

/** 画面の直和を対応するコンポーネントに出し分ける。case が抜けると typecheck で出る。 */
export const ScreenRouter = ({
  screen,
  props,
}: Readonly<{ screen: ConsoleScreen; props: ScreenProps }>): ReactElement => {
  switch (screen) {
    case "apis-services":
      return <ApisServicesScreen {...props} />;
    case "iam":
      return <IamScreen {...props} />;
    case "service-accounts":
      return <ServiceAccountsScreen {...props} />;
    case "roles":
      return <RolesScreen {...props} />;
    case "budgets":
      return <BudgetsScreen {...props} />;
    case "vm-list":
      return <VmListScreen {...props} />;
    case "vm-create":
      return <VmCreateScreen {...props} />;
    case "instance-template-create":
      return <InstanceTemplateCreateScreen {...props} />;
    case "instance-templates":
    case "instance-groups":
    case "disks":
    case "snapshots":
    case "images":
    case "operations":
    case "zones":
      return <ComputeResourceScreen {...props} screen={screen} />;
    case "vpc-networks":
      return <VpcNetworksScreen {...props} />;
    case "firewall":
      return <FirewallScreen {...props} />;
    case "subnets":
      return <SubnetsScreen {...props} />;
    case "ip-addresses":
      return <IpAddressesScreen {...props} />;
    case "vpc-peerings":
      return <VpcPeeringsScreen {...props} />;
    case "cloud-nat":
      return <CloudNatScreen {...props} />;
    case "cloud-routers":
      return <CloudRoutersScreen {...props} />;
    case "buckets":
      return <BucketsScreen {...props} />;
    case "clusters":
      return <ClustersScreen {...props} />;
    case "run-services":
      return <RunServicesScreen {...props} />;
    case "marketplace":
      return <MarketplaceScreen {...props} />;
    case "solution-deployments":
      return <SolutionDeploymentsScreen {...props} />;
  }
};
