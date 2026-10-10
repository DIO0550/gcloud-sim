import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Engine, Shell } from "@/engine";
import { type DataLesson, DataPrelude, DataSolutions } from "@/engine/missions/data-processing";
import { DataProcessingProperties } from "./DataProcessingProperties";

const worldFor = (lesson: DataLesson, end?: number) => {
  const now = "2026-10-01T10:20:00Z";
  return [...DataPrelude, ...DataSolutions[lesson].slice(0, end)].reduce(
    (world, line) => Engine.execute({ world, shell: Shell.Ready, line, now }).world,
    Engine.initialWorld(now),
  );
};
const meta = {
  title: "Simulator/DataProcessingProperties",
  component: DataProcessingProperties,
  args: {
    world: worldFor("load"),
    selection: {
      kind: "data-processing",
      collection: "tables",
      projectId: "ace-dev-01",
      name: "orders",
      location: "US",
      parent: "warehouse",
      jobKind: "",
    },
  },
} satisfies Meta<typeof DataProcessingProperties>;
export default meta;
type Story = StoryObj<typeof meta>;
export const LoadedTable: Story = {};
const job = {
  kind: "data-processing",
  collection: "processingJobs",
  projectId: "ace-dev-01",
  name: "recover-job",
  location: "us-central1",
  parent: "",
  jobKind: "dataflow",
} as const;
export const FailedJob: Story = {
  args: {
    world: worldFor(
      "recovery",
      DataSolutions.recovery.findIndex((s) => s.includes("retry recover")),
    ),
    selection: job,
  },
};
export const RecoveredJob: Story = { args: { world: worldFor("recovery"), selection: job } };
export const PrivateKafka: Story = {
  args: {
    world: worldFor("kafka"),
    selection: {
      kind: "data-processing",
      collection: "kafkaClusters",
      projectId: "ace-dev-01",
      name: "event-kafka",
      location: "us-central1",
      parent: "",
      jobKind: "",
    },
  },
};
