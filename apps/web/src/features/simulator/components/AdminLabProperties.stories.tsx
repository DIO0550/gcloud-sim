import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Engine, Shell } from "@/engine";
import { type AdminLesson, AdminPrelude, AdminSolutions } from "@/engine/missions/admin-lab";
import { AdminLabProperties } from "./AdminLabProperties";

const worldForAdmin = (lesson: AdminLesson, end?: number) => {
  const now = "2026-10-01T10:20:00Z";
  return [...AdminPrelude, ...AdminSolutions[lesson].slice(0, end)].reduce(
    (world, line) => Engine.execute({ world, shell: Shell.Ready, line, now }).world,
    Engine.initialWorld(now),
  );
};
const meta = {
  title: "Simulator/AdminLabProperties",
  component: AdminLabProperties,
  args: {
    world: worldForAdmin("quota", 1),
    selection: {
      kind: "admin-lab",
      scope: "projects/ace-dev-01",
      collection: "quotas",
      name: "admin-cpus",
    },
  },
} satisfies Meta<typeof AdminLabProperties>;
export default meta;
type Story = StoryObj<typeof meta>;
export const QuotaPending: Story = {};
export const QuotaGranted: Story = { args: { world: worldForAdmin("quota") } };
export const OrganizationConstraint: Story = {
  args: {
    world: worldForAdmin("orgPap"),
    selection: {
      kind: "admin-lab",
      scope: "organizations/123456789012",
      collection: "policies",
      name: "storage.publicAccessPrevention",
    },
  },
};
export const IdentityGroup: Story = {
  args: {
    world: worldForAdmin("group"),
    selection: {
      kind: "admin-lab",
      scope: "organizations/123456789012",
      collection: "groups",
      name: "admin-readers@example.com",
    },
  },
};
export const OidcProvider: Story = {
  args: {
    world: worldForAdmin("workforce"),
    selection: {
      kind: "admin-lab",
      scope: "organizations/123456789012",
      collection: "providers",
      name: "workforce/admin-workforce/admin-provider",
    },
  },
};
export const ShortCredential: Story = {
  args: {
    world: worldForAdmin("impersonation"),
    selection: {
      kind: "admin-lab",
      scope: "projects/ace-dev-01",
      collection: "credentials",
      name: "SIMULATED-credential-11",
    },
  },
};
export const BillingExport: Story = {
  args: {
    world: worldForAdmin("export"),
    selection: {
      kind: "admin-lab",
      scope: "projects/ace-dev-01",
      collection: "exports",
      name: "01AB2C-DEF345-6789AB",
    },
  },
};
export const BudgetNotification: Story = {
  args: {
    world: worldForAdmin("budget"),
    selection: {
      kind: "admin-lab",
      scope: "projects/ace-dev-01",
      collection: "observations",
      name: "budget/billingAccounts/01AB2C-DEF345-6789AB/budgets/7a35-budget",
    },
  },
};
