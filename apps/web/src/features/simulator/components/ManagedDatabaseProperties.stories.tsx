import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Engine, Shell } from "@/engine";
import {
  type ManagedDatabaseLesson,
  ManagedDatabasePrelude,
  ManagedDatabaseSolutions,
} from "@/engine/missions/managed-databases";
import { ManagedDatabaseProperties } from "./ManagedDatabaseProperties";

const worldFor = (lesson: ManagedDatabaseLesson, end?: number) => {
  const now = "2026-10-01T10:20:00Z";
  return [...ManagedDatabasePrelude, ...ManagedDatabaseSolutions[lesson].slice(0, end)].reduce(
    (world, line) => Engine.execute({ world, shell: Shell.Ready, line, now }).world,
    Engine.initialWorld(now),
  );
};
const meta = {
  title: "Simulator/ManagedDatabaseProperties",
  component: ManagedDatabaseProperties,
  args: {
    world: worldFor("spanner"),
    selection: {
      kind: "managed-database",
      collection: "spannerInstances",
      projectId: "ace-dev-01",
      name: "global-app",
      instance: "",
      cluster: "",
    },
  },
} satisfies Meta<typeof ManagedDatabaseProperties>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SpannerCapacity: Story = {};
export const BigtableLag: Story = {
  args: {
    world: worldFor("bigtableReplication", 4),
    selection: {
      kind: "managed-database",
      collection: "bigtableInstances",
      projectId: "ace-dev-01",
      name: "replicated",
      instance: "",
      cluster: "",
    },
  },
};
export const BigtableCaughtUp: Story = {
  args: { ...BigtableLag.args, world: worldFor("bigtableReplication") },
};
export const FirestoreBackup: Story = {
  args: {
    world: worldFor("firestoreRestore"),
    selection: {
      kind: "managed-database",
      collection: "firestoreCopies",
      projectId: "ace-dev-01",
      name: "docs-copy",
      instance: "",
      cluster: "",
    },
  },
};
