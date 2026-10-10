import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Engine, Shell } from "@/engine";
import {
  type ComputeLesson,
  ComputePrelude,
  ComputeSolutions,
} from "@/engine/missions/compute-lab";
import { ComputeLabProperties } from "./ComputeLabProperties";

export const worldForCompute = (lesson: ComputeLesson, end?: number) => {
  const now = "2026-10-01T10:20:00Z";
  return [...ComputePrelude, ...ComputeSolutions[lesson].slice(0, end)].reduce((world, line) => {
    const member =
      world.instanceGroups.find((g) => g.name === "healing")?.instanceNames[0] ?? "missing";
    return Engine.execute({ world, shell: Shell.Ready, line: line.replace("@member", member), now })
      .world;
  }, Engine.initialWorld(now));
};
const meta = {
  title: "Simulator/ComputeLabProperties",
  component: ComputeLabProperties,
  args: {
    world: worldForCompute("regional"),
    selection: {
      kind: "compute-lab",
      collection: "disks",
      projectId: "ace-dev-01",
      name: "mirrored",
      location: "us-central1",
    },
  },
} satisfies Meta<typeof ComputeLabProperties>;
export default meta;
type Story = StoryObj<typeof meta>;
export const RegionalDisk: Story = {};
export const RecoveredData: Story = {
  args: {
    world: worldForCompute("restore"),
    selection: {
      kind: "compute-lab",
      collection: "disks",
      projectId: "ace-dev-01",
      name: "recovered-orders",
      location: "us-central1-a",
    },
  },
};
const mig = {
  kind: "compute-lab",
  collection: "migs",
  projectId: "ace-dev-01",
  name: "release",
  location: "us-central1-a",
} as const;
export const RollingUpdate: Story = {
  args: { world: worldForCompute("rolling", -1), selection: mig },
};
export const UpdatedGroup: Story = { args: { world: worldForCompute("rolling"), selection: mig } };
export const TpuVm: Story = {
  args: {
    world: worldForCompute("tpu"),
    selection: {
      kind: "compute-lab",
      collection: "tpus",
      projectId: "ace-dev-01",
      name: "matrix-worker",
      location: "us-central1-b",
    },
  },
};
