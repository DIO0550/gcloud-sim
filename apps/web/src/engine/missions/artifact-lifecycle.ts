import { ContainerLab } from "@/engine/domains/container-lab";
import { IamPolicy } from "@/engine/domains/iam-policy";
import { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export type ArtifactLifecycleAssertion = Readonly<{
  kind: "artifactReleasePromoted" | "containerCleanupComplete";
}>;
const base = "us-central1-docker.pkg.dev/ace-dev-01";
const release = `${base}/ace-images/hello`;
const cleanup = `${base}/cleanup-images`;
const repoId = ContainerLab.repositoryId(F.devProjectId, "us-central1", "cleanup-images");
const local = "cleanup-local:v1";
const setup = [
  { kind: "setPrincipal", principal: F.owner },
  { kind: "setProject", projectId: F.devProjectId },
] as const;
export const ArtifactLifecycleMissions: readonly Mission[] = [
  {
    id: "m-containers-004",
    domain: "デプロイと実装",
    title: "リリースタグを新しいイメージへ切り替える",
    description:
      "ace-imagesのhelloにhello-webをv1、hello-web-v2をv2として登録し、stableタグをv2と同じdigestにします。v1もロールバック用に残します。ローカルのdocker tagだけでは達成しません。",
    setup,
    hints: [
      "gcloud services enable artifactregistry.googleapis.com → gcloud artifacts repositories create ace-images --repository-format=docker --location=us-central1（既にあればdescribeで確認）→ gcloud auth configure-docker us-central1-docker.pkg.dev",
      `docker build -t ${release}:v1 ./hello-web → docker push ${release}:v1 → gcloud artifacts docker tags add ${release}:v1 ${release}:stable`,
      `docker build -t ${release}:v2 ./hello-web-v2 → docker push ${release}:v2。まだstableはv1を指しています。`,
      `gcloud artifacts docker tags add ${release}:v2 ${release}:stable → gcloud artifacts docker tags list ${release}。v1を残し、v2とstableのdigestが一致すれば完了です。`,
    ],
    assertions: [{ kind: "artifactReleasePromoted" }],
  },
  {
    id: "m-containers-005",
    domain: "運用の維持",
    title: "残すイメージを守りながらコンテナ教材を片付ける",
    description:
      "開始時にcleanup-imagesへ旧版old:v1と保存用keep:v2、ローカルにcleanup-localコンテナとcleanup-local:v1タグを用意します。旧版・教材コンテナ・ローカルタグを削除し、リポジトリとkeep:v2を残してください。他の教材のローカルタグは削除不要です。",
    setup: [...setup, { kind: "ensureContainerCleanupLab" }],
    hints: [
      `docker ps -a → docker images → gcloud artifacts docker images list ${cleanup} --include-tags。ローカルとリモートは別々に片付けます。`,
      "docker stop cleanup-local → docker rm cleanup-local → docker rmi cleanup-local:v1。他のタグで同じdigestを利用している場合、そのイメージは残ります。",
      `gcloud artifacts docker tags delete ${cleanup}/old:v1 → 確認にy。タグが消えてもdigestは残るので、これだけでは達成しません。`,
      `gcloud artifacts docker images delete ${cleanup}/old → 確認にy → gcloud artifacts docker images list ${cleanup} --include-tags。keep:v2とリポジトリ自体は残します。`,
    ],
    assertions: [{ kind: "containerCleanupComplete" }],
  },
];

/** Dedicated fixture; never replaces an existing repository or unrelated local references. */
export const ensureContainerCleanupLab = (world: World): Result<World, string> => {
  if (world.containerLab.repositories.some((r) => r.id === repoId)) return Result.ok(world);
  const project = World.findActiveProject(world, F.devProjectId);
  if (!Option.isSome(project)) return Result.err("Cleanup project is missing or inactive.");
  if (
    world.containerLab.containers.some((c) => c.name === "cleanup-local") ||
    world.containerLab.images.some((i) => i.tags.includes(local))
  )
    return Result.err(
      "cleanup-local is already in use. Remove or rename that container/tag before starting this lesson.",
    );
  const now = "2026-01-01T00:00:00.000Z";
  const numbered = World.nextNumber(world);
  let lab = ContainerLab.withImage(world.containerLab, "hello-web", local, now);
  lab = {
    ...lab,
    repositories: [
      ...lab.repositories,
      {
        id: repoId,
        projectId: F.devProjectId,
        location: "us-central1",
        name: "cleanup-images",
        description: "Cleanup lesson",
        immutableTags: false,
        iamPolicy: IamPolicy.Empty,
        created: now,
      },
    ],
    containers: [
      ...lab.containers,
      {
        id: `sim-container-${numbered.number}`,
        name: "cleanup-local",
        imageId: ContainerLab.digest("hello-web"),
        imageRef: local,
        status: "RUNNING",
        hostPort: 0,
        containerPort: 0,
        created: now,
      },
    ],
  };
  lab = ContainerLab.publish(
    lab,
    ContainerLab.registryReference(`${cleanup}/old:v1`),
    "hello-web",
    now,
  );
  lab = ContainerLab.publish(
    lab,
    ContainerLab.registryReference(`${cleanup}/keep:v2`),
    "hello-web-v2",
    now,
  );
  return Result.ok({
    ...numbered.world,
    containerLab: lab,
    projects: world.projects.map((p) =>
      p === project.value
        ? {
            ...p,
            enabledApis: [
              ...new Set([...p.enabledApis, "artifactregistry.googleapis.com" as const]),
            ],
          }
        : p,
    ),
  });
};

export const artifactLifecycleSatisfied = (
  world: World,
  assertion: ArtifactLifecycleAssertion,
): boolean => {
  const images = world.containerLab.registryImages;
  if (assertion.kind === "artifactReleasePromoted") {
    const id = ContainerLab.registryReference(`${release}:v1`).repositoryId;
    return (
      images.some(
        (i) =>
          i.repositoryId === id &&
          i.name === "hello" &&
          i.recipe === "hello-web" &&
          i.tags.includes("v1"),
      ) &&
      images.some(
        (i) =>
          i.repositoryId === id &&
          i.name === "hello" &&
          i.recipe === "hello-web-v2" &&
          i.tags.includes("v2") &&
          i.tags.includes("stable"),
      )
    );
  }
  return (
    world.containerLab.repositories.some((r) => r.id === repoId) &&
    images.some(
      (i) =>
        i.repositoryId === repoId &&
        i.name === "keep" &&
        i.recipe === "hello-web-v2" &&
        i.tags.includes("v2"),
    ) &&
    !images.some((i) => i.repositoryId === repoId && i.name === "old") &&
    !world.containerLab.containers.some((c) => c.name === "cleanup-local") &&
    !world.containerLab.images.some((i) => i.tags.includes(local))
  );
};
