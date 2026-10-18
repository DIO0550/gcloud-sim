import { AdministrationGuides } from "./administration";
import { BasicsGuides } from "./basics";
import { ComputeGuides } from "./compute";
import { ConfigurationGuides } from "./configuration";
import { ContainersGuides } from "./containers";
import { KubernetesGuides } from "./kubernetes";
import { MessagingGuides } from "./messaging";
import type { MissionGuide } from "./model";
import { ObservabilityGuides } from "./observability";
import { StorageGuides } from "./storage";
import { TerraformGuides } from "./terraform";

const Guides: Readonly<Record<string, MissionGuide>> = {
  ...BasicsGuides,
  ...ComputeGuides,
  ...StorageGuides,
  ...AdministrationGuides,
  ...ObservabilityGuides,
  ...MessagingGuides,
  ...TerraformGuides,
  ...ContainersGuides,
  ...KubernetesGuides,
  ...ConfigurationGuides,
};

export const MissionGuides = {
  find(id: string): MissionGuide | undefined {
    return Guides[id];
  },
} as const;
