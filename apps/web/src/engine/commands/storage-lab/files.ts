import { type CommandSpec, Flag, ParsedArgs, type ProjectContext } from "@/engine/cli/command-spec";
import { invalid, missing, name, sf, text } from "@/engine/commands/compute-lab/shared";
import { fileProfileValid } from "@/engine/domains/storage-lab/files";
import { type FileStorage, patchStorage } from "@/engine/domains/storage-lab/model";
import { storageConfig } from "./config";
import { storageFinish } from "./runtime";

const definitions = [
  {
    kind: "filestore",
    path: ["gcloud", "filestore", "instances"],
    permission: "file.instances",
    api: "file.googleapis.com",
  },
  {
    kind: "netapp-pool",
    path: ["gcloud", "netapp", "storage-pools"],
    permission: "netapp.storagePools",
    api: "netapp.googleapis.com",
  },
  {
    kind: "netapp-volume",
    path: ["gcloud", "netapp", "volumes"],
    permission: "netapp.volumes",
    api: "netapp.googleapis.com",
  },
  {
    kind: "lustre",
    path: ["gcloud", "lustre", "instances"],
    permission: "lustre.instances",
    api: "lustre.googleapis.com",
  },
] as const;
const networkName = (value: string, project: string): string => {
  if (value.startsWith("projects/")) {
    const match = /^projects\/([^/]+)\/global\/networks\/([^/]+)$/.exec(value);
    return match?.[1] === project ? (match[2] ?? "") : "";
  }
  return value;
};
const capacity = (value: string): number => {
  const match = /^(\d+(?:\.\d+)?)(GB|TB|GiB|TiB)$/.exec(value);
  if (!match) {
    return -1;
  }
  const unit = match[2];
  return Number(match[1]) * (unit === "TB" || unit === "TiB" ? 1024 : 1);
};
const configured = (c: ProjectContext, a: ParsedArgs, kind: FileStorage["kind"]): FileStorage => {
  const share = ParsedArgs.keyvalue(a, "file-share");
  const network = ParsedArgs.keyvalue(a, "network");
  const pool = c.world.storageLab.files.find(
    (f) =>
      f.kind === "netapp-pool" &&
      f.projectId === c.project.projectId &&
      f.location === text(a, "location") &&
      f.name === text(a, "storage-pool"),
  );
  const base = {
    projectId: c.project.projectId,
    name: name(a),
    kind,
    location: text(a, "location"),
    network: "",
    capacity: -1,
    tier: "",
    protocol: "",
    share: "",
    pool: "",
  };
  if (kind === "filestore") {
    return {
      ...base,
      location: text(a, "zone"),
      network: networkName(network.name ?? "", base.projectId),
      capacity: capacity(share.capacity ?? ""),
      tier: text(a, "tier", "BASIC_HDD"),
      protocol: text(a, "protocol", "NFS_V3"),
      share: share.name ?? "",
    };
  }
  if (kind === "netapp-pool") {
    return {
      ...base,
      network: networkName(network.name ?? "", base.projectId),
      capacity: Number(text(a, "capacity")),
      tier: text(a, "service-level").toUpperCase(),
    };
  }
  if (kind === "netapp-volume") {
    return {
      ...base,
      network: pool?.network ?? "",
      capacity: Number(text(a, "capacity")),
      tier: pool?.tier ?? "",
      protocol: text(a, "protocols").toUpperCase(),
      share: text(a, "share-name"),
      pool: text(a, "storage-pool"),
    };
  }
  return {
    ...base,
    network: networkName(text(a, "network"), base.projectId),
    capacity: Number(text(a, "capacity-gib")),
    tier: text(a, "per-unit-storage-throughput"),
    protocol: "LUSTRE",
    share: text(a, "filesystem"),
  };
};
const createFlags = (kind: FileStorage["kind"]) => {
  if (kind === "filestore") {
    return [
      sf("zone", true),
      sf("tier"),
      sf("protocol"),
      Flag.keyvalue("file-share", "name=SHARE,capacity=1TB", { required: true }),
      Flag.keyvalue("network", "name=NETWORK", { required: true }),
    ];
  }
  if (kind === "netapp-pool") {
    return [
      sf("location", true),
      sf("capacity", true),
      sf("service-level", true),
      Flag.keyvalue("network", "name=NETWORK", { required: true }),
    ];
  }
  if (kind === "netapp-volume") {
    return [
      sf("location", true),
      sf("capacity", true),
      sf("storage-pool", true),
      sf("protocols", true),
      sf("share-name", true),
    ];
  }
  return [
    sf("location", true),
    sf("capacity-gib", true),
    sf("per-unit-storage-throughput", true),
    sf("filesystem", true),
    sf("network", true),
  ];
};
export const FileStorageCommands: readonly CommandSpec[] = definitions.flatMap((d) =>
  ["create", "list", "describe", "delete"].map((op) =>
    storageConfig(
      [...d.path, op],
      `${d.permission}.${op === "describe" ? "get" : op}`,
      d.api,
      (c, a) => {
        const location = text(a, d.kind === "filestore" ? "zone" : "location");
        const resources = c.world.storageLab.files.filter(
          (f) =>
            f.projectId === c.project.projectId && f.kind === d.kind && f.location === location,
        );
        if (op === "list") {
          return storageFinish(c.world, { resources });
        }
        const existing = resources.find((f) => f.name === name(a));
        if (op === "create") {
          if (existing) {
            return invalid("Resource already exists in this location.");
          }
          const network = ParsedArgs.keyvalue(a, "network");
          const share = ParsedArgs.keyvalue(a, "file-share");
          if (
            Object.keys(network).some((k) => k !== "name") ||
            Object.keys(share).some((k) => !["name", "capacity"].includes(k))
          ) {
            return invalid("Only network name and file-share name/capacity are supported.");
          }
          const resource = configured(c, a, d.kind);
          if (!fileProfileValid(resource)) {
            return invalid(
              "Unsupported configuration. Use a documented fixed storage profile from the Storage lessons.",
            );
          }
          return storageFinish(
            patchStorage(c.world, { files: [...c.world.storageLab.files, resource] }),
            { ...resource, state: "READY" },
          );
        }
        if (!existing) {
          return missing("Resource does not exist in this project/location.");
        }
        if (op === "describe") {
          return storageFinish(c.world, { ...existing, state: "READY" });
        }
        if (
          d.kind === "netapp-pool" &&
          c.world.storageLab.files.some(
            (f) =>
              f.kind === "netapp-volume" &&
              f.projectId === existing.projectId &&
              f.location === existing.location &&
              f.pool === existing.name,
          )
        ) {
          return invalid("Delete volumes before deleting their storage pool.");
        }
        return storageFinish(
          patchStorage(c.world, { files: c.world.storageLab.files.filter((f) => f !== existing) }),
          { deleted: existing.name },
        );
      },
      op === "create"
        ? createFlags(d.kind)
        : [sf(d.kind === "filestore" ? "zone" : "location", true)],
      op !== "list",
      op === "delete",
    ),
  ),
);
export const StorageSelectionCommands: readonly CommandSpec[] = [
  storageConfig(
    ["sim", "storage", "choose"],
    "storage.buckets.get",
    "storage.googleapis.com",
    (c, a) => {
      const workload = text(a, "workload");
      const resource = text(a, "resource");
      const choices: Readonly<Record<string, string>> = {
        object: "storage",
        nfs: "filestore",
        "enterprise-nfs": "netapp-volume",
        hpc: "lustre",
        "bulk-transfer": "transfer",
      };
      const service = choices[workload];
      let exists = c.world.storageLab.files.some(
        (f) => f.projectId === c.project.projectId && f.kind === service && f.name === resource,
      );
      if (service === "storage") {
        exists = c.world.buckets.some(
          (b) => b.projectId === c.project.projectId && b.name === resource,
        );
      }
      if (service === "transfer") {
        exists = c.world.storageLab.transfers.some(
          (t) =>
            t.projectId === c.project.projectId && t.name === resource && t.operation === "SUCCESS",
        );
      }
      if (!service || !exists) {
        return invalid("Choose an existing configured resource suited to this workload.");
      }
      const decision = {
        projectId: c.project.projectId,
        name: `selection:${workload}`,
        workload,
        service,
        protection: resource,
      };
      return storageFinish(
        patchStorage(c.world, {
          decisions: [
            ...c.world.storageLab.decisions.filter(
              (d) => d.projectId !== decision.projectId || d.name !== decision.name,
            ),
            decision,
          ],
        }),
        decision,
      );
    },
    [
      Flag.enum(
        "workload",
        "Storage access pattern.",
        ["object", "nfs", "enterprise-nfs", "hpc", "bulk-transfer"],
        { required: true },
      ),
      sf("resource", true),
    ],
    false,
  ),
];
