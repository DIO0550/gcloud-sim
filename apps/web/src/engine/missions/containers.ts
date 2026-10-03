import { ContainerLab } from "@/engine/domains/container-lab";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";

export type ContainerAssertion =
  | Readonly<{ kind: "localContainerReady"; name: string; hostPort: number }>
  | Readonly<{ kind: "artifactPublished"; readerOnly: boolean }>;
const setup = [
  { kind: "setPrincipal", principal: F.owner },
  { kind: "setProject", projectId: F.devProjectId },
] as const;
const image = "us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v1";
const repoId = ContainerLab.repositoryId(F.devProjectId, "us-central1", "ace-images");
const publishHints = [
  "gcloud services enable artifactregistry.googleapis.com → gcloud artifacts repositories create ace-images --repository-format=docker --location=us-central1。既に存在する場合はdescribeで確認します。",
  `docker build -t hello:v1 ./hello-web → docker tag hello:v1 ${image} → gcloud auth configure-docker us-central1-docker.pkg.dev`,
  `docker push ${image} → gcloud artifacts docker images list us-central1-docker.pkg.dev/ace-dev-01/ace-images --include-tags。docker imagesはローカル側の一覧です。`,
];
export const ContainerMissions: readonly Mission[] = [
  {
    id: "m-containers-001",
    domain: "デプロイと実装",
    title: "Dockerイメージを作りローカルで動かす",
    description:
      "組み込みhello-webをhello:v1としてビルドし、hello-localコンテナを起動してホスト8080からコンテナ8080へ公開します。ビルドだけ、停止中、ポートの誤設定では完了しません。実際のプロセス・通信は発生しません。",
    setup,
    hints: [
      "sim docker example ./hello-web → docker build -t hello:v1 ./hello-web → docker images",
      "docker run -d --name hello-local -p 8080:8080 hello:v1 → docker ps → docker logs hello-local",
      "sim docker request hello-local で疑似HTTP応答を確認します。終了後はdocker stop hello-local → docker rm hello-local。",
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
    hints: publishHints,
    assertions: [{ kind: "artifactPublished", readerOnly: false }],
  },
  {
    id: "m-containers-003",
    domain: "アクセスとセキュリティ",
    title: "イメージを読み取り専用で共有する",
    description:
      "ace-imagesへhello:v1を登録し、developer@example.comに対象リポジトリのArtifact Registry Readerを付与します。イメージのダウンロードが許可され、アップロード権限がない状態にします。",
    setup,
    hints: [
      ...publishHints,
      "gcloud artifacts repositories add-iam-policy-binding ace-images --location=us-central1 --member=user:developer@example.com --role=roles/artifactregistry.reader",
      `gcloud auth login developer@example.com → docker pull ${image}。docker pushは権限不足になります。writerやadminなどの既存付与があれば、所有者で継承元を確認して外します。`,
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
