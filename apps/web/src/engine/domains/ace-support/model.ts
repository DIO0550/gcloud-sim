import type { World } from "@/engine/domains/world";
import { Decoder as D, type Decoder } from "@/utils/Decoder";
import { Result } from "@/utils/Result";
import { findScenario } from "./catalog";

export const AiRegions = ["asia-northeast1", "us-central1"] as const;
export const AiKinds = ["agent", "notebook", "workstation"] as const;
export const AiPlatforms = ["vertex-ai", "workbench", "workstations"] as const;
export type AiResource = Readonly<{
  projectId: string;
  name: string;
  region: (typeof AiRegions)[number];
  kind: (typeof AiKinds)[number];
  platform: (typeof AiPlatforms)[number];
  serviceAccount: string;
  subnet: string;
  access: "private" | "public";
  idleMinutes: number;
  status: "CONFIGURED" | "RUNNING" | "STOPPED";
  revision: number;
  lastStartedRevision: number;
  publicStoppedRevision: number;
  securedFromRevision: number;
  starts: number;
  stops: number;
}>;
export type AceDecision = Readonly<{
  projectId: string;
  scenario: string;
  choice: string;
  reason: string;
  attempts: number;
}>;
export type AceSupport = Readonly<{
  resources: readonly AiResource[];
  decisions: readonly AceDecision[];
}>;
export const emptyAceSupport = (): AceSupport => ({ resources: [], decisions: [] });
const boundedArray = <T>(item: Decoder<T>, max: number): Decoder<readonly T[]> => {
  const decode = D.array(item);
  return (value, path) =>
    Array.isArray(value) && value.length > max
      ? Result.err(`${path} exceeds the ${max} item lesson limit`)
      : decode(value, path);
};
export const aceSupportDecoder = D.object<AceSupport>({
  resources: boundedArray(
    D.object<AiResource>({
      projectId: D.string,
      name: D.string,
      region: D.literal(AiRegions),
      kind: D.literal(AiKinds),
      platform: D.literal(AiPlatforms),
      serviceAccount: D.string,
      subnet: D.string,
      access: D.literal(["private", "public"]),
      idleMinutes: D.number,
      status: D.literal(["CONFIGURED", "RUNNING", "STOPPED"]),
      revision: D.number,
      lastStartedRevision: D.number,
      publicStoppedRevision: D.number,
      securedFromRevision: D.number,
      starts: D.number,
      stops: D.number,
    }),
    50,
  ),
  decisions: boundedArray(
    D.object<AceDecision>({
      projectId: D.string,
      scenario: D.string,
      choice: D.string,
      reason: D.string,
      attempts: D.number,
    }),
    400,
  ),
});

export const aiIdentity = (r: Pick<AiResource, "projectId" | "name" | "region">): string =>
  `${r.projectId}/${r.region}/${r.name}`;
export const compatiblePlatform = (r: Pick<AiResource, "kind" | "platform">): boolean => {
  const platforms = {
    agent: "vertex-ai",
    notebook: "workbench",
    workstation: "workstations",
  } as const;
  return platforms[r.kind] === r.platform;
};

const count = (n: number): boolean => Number.isSafeInteger(n) && n >= 0 && n <= 100000;
const validLifecycle = (r: AiResource): boolean => {
  if (
    ![
      r.revision,
      r.lastStartedRevision,
      r.publicStoppedRevision,
      r.securedFromRevision,
      r.starts,
      r.stops,
    ].every(count)
  ) {
    return false;
  }
  if (r.revision < 1 || r.lastStartedRevision > r.revision) {
    return false;
  }
  if (
    r.publicStoppedRevision > r.lastStartedRevision ||
    (r.publicStoppedRevision > 0 && r.stops === 0) ||
    (r.securedFromRevision > 0 &&
      (r.access !== "private" ||
        r.securedFromRevision !== r.publicStoppedRevision ||
        r.securedFromRevision >= r.revision))
  ) {
    return false;
  }
  switch (r.status) {
    case "CONFIGURED":
      return r.starts === 0 && r.stops === 0 && r.lastStartedRevision === 0;
    case "RUNNING":
      return r.lastStartedRevision === r.revision && r.starts === r.stops + 1;
    case "STOPPED":
      return r.stops > 0 && r.starts === r.stops && r.lastStartedRevision > 0;
  }
};

/** 保存するのは教材の構成と明示操作の履歴。実行結果、性能、料金は生成しない。 */
export const validateAceSupport = (world: World): Result<World, string> => {
  const lab = world.aceSupport;
  if (lab.resources.length > 50 || lab.decisions.length > 400) {
    return Result.err("ACE lesson resource limit exceeded.");
  }
  const resourceIds = new Set(lab.resources.map(aiIdentity));
  const decisionIds = new Set(lab.decisions.map((d) => `${d.projectId}/${d.scenario}`));
  if (resourceIds.size !== lab.resources.length || decisionIds.size !== lab.decisions.length) {
    return Result.err("Duplicate ACE lesson identity.");
  }
  for (const r of lab.resources) {
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(r.name) || !compatiblePlatform(r)) {
      return Result.err("Invalid AI lesson name or kind/platform combination.");
    }
    const project = world.projects.some((p) => p.projectId === r.projectId);
    const sa = world.serviceAccounts.some(
      (s) => s.projectId === r.projectId && s.email === r.serviceAccount,
    );
    const subnet = world.subnets.some(
      (s) => s.projectId === r.projectId && s.region === r.region && s.name === r.subnet,
    );
    if (!project || !sa || !subnet) {
      return Result.err(
        "AI lesson needs a project, service account and subnet in the same region/project.",
      );
    }
    if (!Number.isInteger(r.idleMinutes)) {
      return Result.err("Idle timeout must be an integer.");
    }
    if (r.kind === "agent" && r.idleMinutes !== 0) {
      return Result.err("Agent does not use a notebook/IDE idle timeout.");
    }
    if (r.kind !== "agent" && (r.idleMinutes < 5 || r.idleMinutes > 240)) {
      return Result.err("Notebook/IDE lesson idle timeout is 5..240 minutes.");
    }
    if (!validLifecycle(r)) {
      return Result.err("Invalid AI lesson lifecycle evidence.");
    }
  }
  for (const d of lab.decisions) {
    const scenario = findScenario(d.scenario);
    if (!scenario?.choices.includes(d.choice)) {
      return Result.err("Unknown ACE scenario or choice.");
    }
    if (!world.projects.some((p) => p.projectId === d.projectId)) {
      return Result.err("ACE decision needs an existing project.");
    }
    if (
      d.reason.trim().length < 4 ||
      d.reason.length > 500 ||
      !count(d.attempts) ||
      d.attempts === 0
    ) {
      return Result.err("Invalid ACE explanation or attempt count.");
    }
  }
  return Result.ok(world);
};
