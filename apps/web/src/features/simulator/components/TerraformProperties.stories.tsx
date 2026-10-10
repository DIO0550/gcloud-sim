import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Engine, Shell } from "@/engine";
import { TerraformLessonSteps } from "@/engine/missions/terraform-lessons";
import { TerraformProperties } from "./TerraformProperties";

const worldFor = (lesson: keyof typeof TerraformLessonSteps) =>
  TerraformLessonSteps[lesson].reduce(
    (world, line) =>
      Engine.execute({ world, line, shell: Shell.Ready, now: "2026-10-01T10:20:00Z" }).world,
    Engine.initialWorld("2026-10-01T10:20:00Z"),
  );
const meta = {
  title: "Simulator/TerraformProperties",
  component: TerraformProperties,
  args: {
    world: worldFor("auto"),
    selection: { kind: "terraform", collection: "workspace", name: "作業領域" },
  },
} satisfies Meta<typeof TerraformProperties>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AutoWorkspace: Story = {};
export const SavedPlan: Story = {
  args: { selection: { kind: "terraform", collection: "plans", name: "auto-plan" } },
};
export const IndexedResource: Story = {
  args: {
    selection: {
      kind: "terraform",
      collection: "resources",
      name: "google_compute_instance.web[0]",
    },
  },
};
export const SensitiveOutput: Story = { args: { world: worldFor("sensitive") } };
