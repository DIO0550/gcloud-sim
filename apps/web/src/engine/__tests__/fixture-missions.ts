import { MissionProgress } from "@/engine/domains/mission-progress";
import { World } from "@/engine/domains/world";
import { Mission as PublicMission, ScenarioMissions } from "@/engine/missions";
import { Option } from "@/utils/Option";

export * from "@/engine/missions";

/** 廃止した演習の述語はドメインモデルの回帰テストにだけ使う。 */
export const Mission = {
  ...PublicMission,
  all: () => ScenarioMissions,
  find: (id: string) => Option.fromNullable(ScenarioMissions.find((m) => m.id === id)),
  start(world: World, mission: PublicMission) {
    const seeded = Option.isSome(World.findMissionProgress(world, mission.id))
      ? world
      : { ...world, missions: [...world.missions, MissionProgress.create(mission.id)] };
    return PublicMission.start(seeded, mission);
  },
  evaluate(world: World) {
    return World.missionsInProgress(world).reduce(
      (acc, progress) => {
        const mission = ScenarioMissions.find((m) => m.id === progress.id);
        if (!mission || !PublicMission.assertionResults(acc.world, mission).every(Boolean)) {
          return acc;
        }
        return {
          world: World.replaceMissionProgress(acc.world, MissionProgress.complete(progress)),
          completed: [...acc.completed, mission],
        };
      },
      { world, completed: [] as PublicMission[] },
    );
  },
} as const;
