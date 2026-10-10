import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Engine, Shell } from "@/engine";
import { ContainerReleaseSteps } from "@/engine/missions/container-release";
import { ContainerLabProperties } from "./ContainerLabProperties";

const worldFor = (end?: number) => {
  const now = "2026-10-01T10:20:00Z";
  return ContainerReleaseSteps.slice(0, end).reduce(
    (world, line) => Engine.execute({ world, shell: Shell.Ready, line, now }).world,
    Engine.initialWorld(now),
  );
};
const meta = {
  title: "Simulator/ContainerLabProperties",
  component: ContainerLabProperties,
  args: {
    world: worldFor(4),
    selection: { kind: "container-lab", collection: "releases", id: "ace-release" },
  },
} satisfies Meta<typeof ContainerLabProperties>;
export default meta;
type Story = StoryObj<typeof meta>;
export const LocalValidated: Story = {};
export const DeploymentValidated: Story = { args: { world: worldFor(16) } };
export const Cleaned: Story = { args: { world: worldFor() } };
