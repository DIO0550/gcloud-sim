import { ContainerLab } from "@/engine/domains/container-lab";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";

export type ContainerAssertion =
  | Readonly<{ kind: "localContainerReady"; name: string; hostPort: number }>
  | Readonly<{ kind: "artifactPublished"; readerOnly: boolean }>;
const setup = [
  { kind: "setPrincipal", principal: F.owner },
  { kind: "setProject", projectId: F.devProjectId },
] as const;
const image = "us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v1";
const repoId = ContainerLab.repositoryId(F.devProjectId, "us-central1", "ace-images");
/** リポジトリを用意してhello:v1をpushするまで（002と003で共通）。 */
const publishSteps: readonly MissionStep[] = [
  MissionStep.run(
    "Artifact RegistryのAPIを有効にする",
    "gcloud services enable artifactregistry.googleapis.com",
  ),
  MissionStep.run(
    "Dockerリポジトリace-imagesを作る",
    "gcloud artifacts repositories create ace-images --repository-format=docker --location=us-central1",
    "既に存在する場合はdescribeで確認します。",
  ),
  MissionStep.run("hello-webをhello:v1としてビルドする", "docker build -t hello:v1 ./hello-web"),
  MissionStep.run(
    "ローカルのイメージにリポジトリ向けのタグを付ける",
    `docker tag hello:v1 ${image}`,
  ),
  MissionStep.run(
    "dockerがArtifact Registryへ認証できるようにする",
    "gcloud auth configure-docker us-central1-docker.pkg.dev",
  ),
  MissionStep.run("イメージをリポジトリへpushする", `docker push ${image}`),
  MissionStep.run(
    "リポジトリにhello:v1が登録されたか確かめる",
    "gcloud artifacts docker images list us-central1-docker.pkg.dev/ace-dev-01/ace-images --include-tags",
    "docker imagesはローカル側の一覧です。",
  ),
];
export const ContainerMissions: readonly Mission[] = [
  {
    id: "m-containers-001",
    domain: "デプロイと実装",
    title: "Dockerイメージを作りローカルで動かす",
    description:
      "組み込みhello-webをhello:v1としてビルドし、hello-localコンテナを起動してホスト8080からコンテナ8080へ公開します。ビルドだけ、停止中、ポートの誤設定では完了しません。実際のプロセス・通信は発生しません。",
    setup,
    steps: [
      MissionStep.run(
        "hello-webをhello:v1としてビルドする",
        "docker build -t hello:v1 ./hello-web",
        "組み込みのhello-webを使用します。",
      ),
      MissionStep.run("ローカルにイメージができたか確かめる", "docker images"),
      MissionStep.run(
        "hello-localをホスト8080で公開して起動する",
        "docker run -d --name hello-local -p 8080:8080 hello:v1",
      ),
      MissionStep.run("コンテナが動いているか確かめる", "docker ps"),
      MissionStep.run("コンテナのログを見る", "docker logs hello-local"),
      MissionStep.run(
        "コンテナの状態とポートを確かめる",
        "docker inspect hello-local",
        "終了後は次の2つの手順で片付けます。",
      ),
      MissionStep.run("片付けでコンテナを止める", "docker stop hello-local"),
      MissionStep.run("片付けでコンテナを削除する", "docker rm hello-local"),
    ],
    assertions: [{ kind: "localContainerReady", name: "hello-local", hostPort: 8080 }],
  },
  {
    id: "m-containers-002",
    domain: "デプロイと実装",
    title: "Artifact Registryへイメージを公開する",
    description:
      "ace-dev-01のus-central1にDockerリポジトリace-imagesを用意し、hello-web v1をhello:v1としてpushします。ローカルのtagだけでは完了しません。",
    setup,
    steps: publishSteps,
    assertions: [{ kind: "artifactPublished", readerOnly: false }],
  },
  {
    id: "m-containers-003",
    domain: "アクセスとセキュリティ",
    title: "イメージを読み取り専用で共有する",
    description:
      "ace-imagesへhello:v1を登録し、developer@example.comに対象リポジトリのArtifact Registry Readerを付与します。イメージのダウンロードが許可され、アップロード権限がない状態にします。",
    setup,
    steps: [
      ...publishSteps,
      MissionStep.run(
        "developerにリポジトリの読み取りだけを許可する",
        "gcloud artifacts repositories add-iam-policy-binding ace-images --location=us-central1 --member=user:developer@example.com --role=roles/artifactregistry.reader",
      ),
      MissionStep.run("developerに切り替える", "gcloud auth login developer@example.com"),
      MissionStep.run(
        "developerとしてイメージを取得できるか確かめる",
        `docker pull ${image}`,
        "docker pushは権限不足になります。writerやadminなどの既存付与があれば、所有者で継承元を確認して外します。",
      ),
    ],
    assertions: [{ kind: "artifactPublished", readerOnly: true }],
  },
];
export const containerSatisfied = (world: World, assertion: ContainerAssertion): boolean => {
  if (assertion.kind === "localContainerReady")
    return world.containerLab.containers.some(
      (c) =>
        c.name === assertion.name &&
        c.status === "RUNNING" &&
        c.hostPort === assertion.hostPort &&
        c.containerPort === 8080 &&
        c.imageId === ContainerLab.digest("hello-web") &&
        world.containerLab.images.some((i) => i.id === c.imageId && i.tags.includes("hello:v1")),
    );
  const repo = world.containerLab.repositories.find((r) => r.id === repoId);
  if (
    !repo ||
    !world.containerLab.registryImages.some(
      (i) =>
        i.repositoryId === repoId &&
        i.name === "hello" &&
        i.tags.includes("v1") &&
        i.recipe === "hello-web",
    )
  )
    return false;
  if (!assertion.readerOnly) return true;
  const member = "user:developer@example.com";
  if (
    !repo.iamPolicy.bindings.some(
      (b) => b.role === "roles/artifactregistry.reader" && b.members.includes(member),
    )
  )
    return false;
  const permissions = EffectivePermissions.resolve(world, member, {
    type: "artifact-repository",
    id: repoId,
  });
  return (
    permissions.permissions.has("artifactregistry.repositories.downloadArtifacts") &&
    !permissions.permissions.has("artifactregistry.repositories.uploadArtifacts")
  );
};
