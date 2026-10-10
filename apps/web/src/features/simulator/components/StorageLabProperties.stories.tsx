import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Engine, Shell } from "@/engine";
import {
  type StorageLesson,
  StoragePrelude,
  StorageSolutions,
} from "@/engine/missions/storage-lab";
import { BucketProperties } from "./ServiceProperties";
import { StorageLabProperties } from "./StorageLabProperties";

const worldForStorage = (lesson: StorageLesson, end?: number) => {
  const now = "2026-10-01T10:20:00Z";
  return [...StoragePrelude, ...StorageSolutions[lesson].slice(0, end)].reduce(
    (world, line) => Engine.execute({ world, shell: Shell.Ready, line, now }).world,
    Engine.initialWorld(now),
  );
};
const meta = {
  title: "Simulator/StorageLabProperties",
  component: StorageLabProperties,
  args: {
    world: worldForStorage("filestore"),
    selection: {
      kind: "storage-lab",
      collection: "files",
      projectId: "ace-dev-01",
      name: "shared-files",
      location: "us-central1-c",
      subtype: "filestore",
    },
  },
} satisfies Meta<typeof StorageLabProperties>;
export default meta;
type Story = StoryObj<typeof meta>;
export const NfsShare: Story = {};
export const NetAppVolume: Story = {
  args: {
    world: worldForStorage("netapp"),
    selection: {
      kind: "storage-lab",
      collection: "files",
      projectId: "ace-dev-01",
      name: "shared-volume",
      location: "us-central1",
      subtype: "netapp-volume",
    },
  },
};
export const ManagedLustre: Story = {
  args: {
    world: worldForStorage("lustre"),
    selection: {
      kind: "storage-lab",
      collection: "files",
      projectId: "ace-dev-01",
      name: "hpc-files",
      location: "us-central1-a",
      subtype: "lustre",
    },
  },
};
export const TransferComplete: Story = {
  args: {
    world: worldForStorage("transfer"),
    selection: {
      kind: "storage-lab",
      collection: "transfers",
      projectId: "ace-dev-01",
      name: "transferJobs/storage-lesson",
      location: "",
      subtype: "",
    },
  },
};
export const ExpiredSignature: Story = {
  args: {
    world: worldForStorage("signed"),
    selection: {
      kind: "storage-lab",
      collection: "signed",
      projectId: "ace-dev-01",
      name: "signed-2",
      location: "",
      subtype: "",
    },
  },
};
export const RecoveredObject: Story = {
  render: () => (
    <BucketProperties
      world={worldForStorage("recovery")}
      selection={{ kind: "bucket", name: "storage-recovery" }}
    />
  ),
};
export const RetentionLocked: Story = {
  render: () => (
    <BucketProperties
      world={worldForStorage("retention")}
      selection={{ kind: "bucket", name: "storage-retention" }}
    />
  ),
};
export const CustomerManagedKey: Story = {
  render: () => (
    <BucketProperties
      world={worldForStorage("cmek")}
      selection={{ kind: "bucket", name: "storage-cmek" }}
    />
  ),
};
