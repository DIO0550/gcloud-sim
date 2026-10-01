import type { ReactElement } from "react";

import { BudgetsScreen } from "@/features/simulator/features/console/components/BillingScreens";
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
import { BucketsScreen } from "@/features/simulator/features/console/components/StorageScreens";
import {
  FirewallScreen,
  SubnetsScreen,
} from "@/features/simulator/features/console/components/VpcScreens";
import type { ConsoleScreen } from "@/features/simulator/features/console/domains/console-screen";
import type { ScreenProps } from "@/features/simulator/features/console/types/screen-props";

/** 画面の直和を対応するコンポーネントに出し分ける。case が抜けると typecheck で出る。 */
export const ScreenRouter = ({
  screen,
  props,
}: Readonly<{ screen: ConsoleScreen; props: ScreenProps }>): ReactElement => {
  switch (screen) {
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
    case "firewall":
      return <FirewallScreen {...props} />;
    case "subnets":
      return <SubnetsScreen {...props} />;
    case "buckets":
      return <BucketsScreen {...props} />;
    case "clusters":
      return <ClustersScreen {...props} />;
    case "run-services":
      return <RunServicesScreen {...props} />;
  }
};
