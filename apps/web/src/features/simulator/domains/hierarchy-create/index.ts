import type { ParentRef } from "@/engine/domains/resource-hierarchy";
import { World } from "@/engine/domains/world";
import type { TreeSelection } from "@/engine/resource-tree";
import { Option } from "@/utils/Option";

export type HierarchyCreation =
  | Readonly<{ kind: "organization"; name: string }>
  | Readonly<{ kind: "folder"; name: string; parent: ParentRef }>
  | Readonly<{
      kind: "project";
      name: string;
      projectId: string;
      parent: ParentRef;
      setAsDefault: boolean;
    }>;

const quote = (value: string): string => `"${value.replace(/(["\\])/g, "\\$1")}"`;

export const HierarchyCreate = {
  command(input: Exclude<HierarchyCreation, { kind: "organization" }>): string {
    const parent = `--${input.parent.type}=${quote(input.parent.id)}`;
    if (input.kind === "folder") {
      return `gcloud resource-manager folders create --display-name=${quote(input.name.trim())} ${parent}`;
    }
    const setDefault = input.setAsDefault ? " --set-as-default" : "";
    return `gcloud projects create ${quote(input.projectId.trim())} --name=${quote(input.name.trim())} ${parent}${setDefault}`;
  },

  defaultParent(world: World, selection: Option<TreeSelection>): ParentRef {
    if (Option.isSome(selection)) {
      const selected = selection.value;
      if (selected.kind === "organization") {
        return { type: "organization", id: selected.id };
      }
      if (selected.kind === "folder") {
        return { type: "folder", id: selected.id };
      }
      if (selected.kind === "project") {
        const project = World.findActiveProject(world, selected.projectId);
        if (Option.isSome(project)) {
          return project.value.parent;
        }
      }
    }
    const project = Option.flatMap(World.currentProjectId(world), (id) =>
      World.findActiveProject(world, id),
    );
    return Option.unwrapOr(
      Option.map(project, (item) => item.parent),
      { type: "organization", id: world.organization.id },
    );
  },
} as const;
