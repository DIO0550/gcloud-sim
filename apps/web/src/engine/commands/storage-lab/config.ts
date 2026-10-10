import {
  type CommandResult,
  type CommandSpec,
  Flag,
  type FlagSpec,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { projectCommand } from "@/engine/commands/shared";
import type { ApiName } from "@/engine/domains/catalog";

export const storageConfig = (
  path: readonly string[],
  permission: string,
  api: ApiName,
  run: (ctx: ProjectContext, args: import("@/engine/cli/command-spec").ParsedArgs) => CommandResult,
  flags: readonly FlagSpec[] = [],
  positional = true,
  destructive = false,
): Extract<CommandSpec, { kind: "project" }> =>
  projectCommand({
    path,
    summary: "Bounded storage configuration; no cloud requests or billing.",
    permission,
    requiredApis: [api],
    run,
    destructive,
    positionals: positional
      ? [
          Positional.required("NAME", "Resource name.", (w, p) => {
            if (!p.some) {
              return [];
            }
            const group = path.join(" ");
            if (group.includes("kms keys versions")) {
              return ["1"];
            }
            if (group.includes("transfer jobs")) {
              return w.storageLab.transfers
                .filter((t) => t.projectId === p.value)
                .map((t) => t.name);
            }
            const kinds: Readonly<Record<string, string>> = {
              filestore: "filestore",
              "netapp storage-pools": "netapp-pool",
              "netapp volumes": "netapp-volume",
              lustre: "lustre",
            };
            const kind = Object.entries(kinds).find(([prefix]) => group.includes(prefix))?.[1];
            return w.storageLab.files
              .filter((f) => f.projectId === p.value && f.kind === kind)
              .map((f) => f.name);
          }),
        ]
      : [],
    flags: [
      ...flags,
      ...(path[0] === "sim"
        ? [
            Flag.string("project", "Project."),
            Flag.string("account", "Principal."),
            ...(destructive ? [Flag.boolean("quiet", "Skip confirmation.")] : []),
          ]
        : []),
    ],
  });
