import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Engine, Shell } from "@/engine";
import {
  type ObserveLesson,
  ObservePrelude,
  ObserveSolutions,
} from "@/engine/missions/observability-lab";
import { ObservabilityLabProperties } from "./ObservabilityLabProperties";

const worldFor = (lesson: ObserveLesson, end?: number) => {
  const now = "2026-10-01T10:20:00Z";
  return [...ObservePrelude, ...ObserveSolutions[lesson].slice(0, end)].reduce(
    (world, line) => Engine.execute({ world, shell: Shell.Ready, line, now }).world,
    Engine.initialWorld(now),
  );
};
const meta = {
  title: "Simulator/ObservabilityLabProperties",
  component: ObservabilityLabProperties,
  args: {
    world: worldFor("notification", -2),
    selection: {
      kind: "observability-lab",
      projectId: "ace-dev-01",
      collection: "channels",
      name: "oncall",
    },
  },
} satisfies Meta<typeof ObservabilityLabProperties>;
export default meta;
type Story = StoryObj<typeof meta>;
export const UnverifiedChannel: Story = {};
export const VerifiedChannel: Story = { args: { world: worldFor("notification") } };
export const ErrorBudget: Story = {
  args: {
    world: worldFor("slo"),
    selection: {
      kind: "observability-lab",
      projectId: "ace-dev-01",
      collection: "objectives",
      name: "availability",
    },
  },
};
export const AnalyticsBucket: Story = {
  args: {
    world: worldFor("routing"),
    selection: {
      kind: "observability-lab",
      projectId: "ace-dev-01",
      collection: "buckets",
      name: "us-central1/archive",
    },
  },
};
export const OpsAgentReady: Story = {
  args: {
    world: worldFor("agent"),
    selection: {
      kind: "observability-lab",
      projectId: "ace-dev-01",
      collection: "collectors",
      name: "us-central1-a/agent",
    },
  },
};
export const PrometheusReady: Story = {
  args: {
    world: worldFor("prometheus"),
    selection: {
      kind: "observability-lab",
      projectId: "ace-dev-01",
      collection: "collectors",
      name: "us-central1/prometheus",
    },
  },
};
export const MultiProjectScope: Story = {
  args: {
    world: worldFor("scope"),
    selection: {
      kind: "observability-lab",
      projectId: "ace-dev-01",
      collection: "scopes",
      name: "ace-prod-01",
    },
  },
};
