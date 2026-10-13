// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine/__tests__/fixture-engine";
import { Mission } from "@/engine/__tests__/fixture-missions";
import { Now, run, type Session, session } from "@/engine/__tests__/fixture-setup";
import { Snapshot } from "@/engine/__tests__/fixture-snapshot";
import {
  AceChallengeMissions,
  NetworkChallengeSteps,
  TerraformChallengeSteps,
} from "@/engine/missions/ace-challenges";

const start = (id: string): Session => {
  const result = Engine.startMission(session().world, id);
  if (!result.ok) {
    throw new Error(result.error.reason);
  }
  return session(result.value);
};
const complete = (id: string, steps: readonly string[]): Session => {
  let state = start(id);
  for (const line of steps) {
    state = run(state, line);
    expect(state.text, line).not.toContain("ERROR:");
  }
  return state;
};

test.each([
  { id: "m-ace-challenge-network", steps: NetworkChallengeSteps },
  { id: "m-ace-challenge-terraform", steps: TerraformChallengeSteps },
])("$id: 初期状態・途中保存・完成後の復元を評価する", ({ id, steps }) => {
  const mission = AceChallengeMissions.find((m) => m.id === id);
  if (!mission) {
    throw new Error("総合演習が見つかりません");
  }
  let state = start(id);
  expect(Mission.assertionResults(state.world, mission).every(Boolean)).toBe(false);
  for (const [index, line] of steps.entries()) {
    state = run(state, line);
    expect(state.text, line).not.toContain("ERROR:");
    if (index < steps.length - 4) {
      expect(Mission.assertionResults(state.world, mission).every(Boolean), line).toBe(false);
    }
    const restored = Snapshot.fromUnknown(Snapshot.create(state.world, Now));
    if (!restored.ok) {
      throw new Error(`${line}: ${JSON.stringify(restored.error)}`);
    }
    state = { ...state, world: restored.value };
  }
  expect(Mission.assertionResults(state.world, mission)).not.toContain(false);
});

test("ネットワーク総合演習は別VPCのSQLや過剰なSA権限では達成しない", () => {
  const state = complete("m-ace-challenge-network", NetworkChallengeSteps);
  const mission = AceChallengeMissions[0];
  if (!mission) {
    throw new Error("ネットワーク総合演習が見つかりません");
  }
  const wrongNetwork = {
    ...state.world,
    relational: {
      ...state.world.relational,
      servers: state.world.relational.servers.map((s) =>
        s.name === "ace-network-db" ? { ...s, network: "default" } : s,
      ),
    },
  };
  expect(Mission.assertionResults(wrongNetwork, mission)).toContain(false);
  const disabled = run(state, "gcloud compute firewall-rules update ace-bastion-ssh --disabled");
  expect(disabled.text).not.toContain("ERROR:");
  expect(Mission.assertionResults(disabled.world, mission)).toContain(false);
  const broad = run(
    state,
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=serviceAccount:ace-network-app@ace-dev-01.iam.gserviceaccount.com --role=roles/viewer",
  );
  expect(broad.text).not.toContain("ERROR:");
  expect(Mission.assertionResults(broad.world, mission)).toContain(false);
});

test("Terraform総合演習はimportしたVPCをstateから外すと未達成になる", () => {
  const state = complete("m-ace-challenge-terraform", TerraformChallengeSteps);
  const removed = run(state, "terraform state rm google_compute_network.imported");
  const mission = AceChallengeMissions[1];
  if (!mission) {
    throw new Error("Terraform総合演習が見つかりません");
  }
  expect(removed.text).not.toContain("ERROR:");
  expect(removed.world.networks.some((n) => n.name === "tf-import-net")).toBe(true);
  expect(Mission.assertionResults(removed.world, mission)).toContain(false);
});
