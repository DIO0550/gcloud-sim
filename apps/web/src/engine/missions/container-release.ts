import {
  ContainerRelease as L,
  releaseCleanupComplete,
} from "@/engine/domains/container-lab/release";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";

export type ContainerReleaseAssertion = Readonly<{ kind: "containerReleaseCleaned" }>;

/**
 * Reused by the mission acceptance test; each entry is a real lesson step.
 * テストと Storybook が行のまま流すので文字列で持ち、ミッションの steps で what を添える。
 */
export const ContainerReleaseSteps = [
  "gcloud services enable artifactregistry.googleapis.com container.googleapis.com",
  "docker build -t release-local:v1 ./hello-web",
  "docker run -d --name release-local -p 8080:8080 release-local:v1",
  "sim container-release validate-local",
  "gcloud artifacts repositories create release-images --repository-format=docker --location=us-central1",
  "gcloud auth configure-docker us-central1-docker.pkg.dev",
  `docker tag release-local:v1 ${L.image}`,
  `docker push ${L.image}`,
  "gcloud iam service-accounts create release-nodes",
  `gcloud iam service-accounts add-iam-policy-binding ${L.nodeAccount} --member=user:owner@example.com --role=roles/iam.serviceAccountUser`,
  `gcloud artifacts repositories add-iam-policy-binding release-images --location=us-central1 --member=serviceAccount:${L.nodeAccount} --role=roles/artifactregistry.reader`,
  `gcloud container clusters create-auto release-gke --region=us-central1 --service-account=${L.nodeAccount}`,
  `kubectl create deployment release-web --image=${L.image} --replicas=2`,
  "kubectl rollout status deployment/release-web",
  "kubectl expose deployment release-web --type=LoadBalancer --port=80 --target-port=8080",
  "sim container-release validate-deployment --region=us-central1",
  "kubectl delete service release-web",
  "kubectl delete deployment release-web",
  "gcloud container clusters delete release-gke --region=us-central1 --quiet",
  "gcloud artifacts repositories delete release-images --location=us-central1 --quiet",
  "docker stop release-local",
  "docker rm release-local",
  `docker rmi ${L.image}`,
  "docker rmi release-local:v1",
  `gcloud iam service-accounts delete ${L.nodeAccount} --quiet`,
  "sim container-release status",
] as const;

export const ContainerReleaseMissions: readonly Mission[] = [
  {
    id: "m-containers-006",
    domain: "運用の維持",
    title: "コンテナを検証・公開して教材を片付ける",
    description:
      "hello-webをローカルの8080で検証し、release-imagesへpush。Reader専用のノードSAでrelease-gkeへ2レプリカを配置し、80→8080で公開した証跡を保存します。その後、専用クラスタ・リポジトリ・ローカルコンテナ/タグ・ノードSAを削除します。空の初期状態や、検証前の削除だけではクリアしません。他の教材リソースは削除不要です。",
    setup: [
      { kind: "resetContainerReleaseEvidence" },
      { kind: "setPrincipal", principal: F.owner },
      { kind: "setProject", projectId: F.devProjectId },
    ],
    steps: [
      MissionStep.run("Artifact RegistryとGKEのAPIを有効にする", ContainerReleaseSteps[0]),
      MissionStep.run("hello-webをローカル検証用にビルドする", ContainerReleaseSteps[1]),
      MissionStep.run("release-localをホスト8080で起動する", ContainerReleaseSteps[2]),
      MissionStep.run("ローカルでの動作を検証して証跡を残す", ContainerReleaseSteps[3]),
      MissionStep.run("Dockerリポジトリrelease-imagesを作る", ContainerReleaseSteps[4]),
      MissionStep.run("dockerがArtifact Registryへ認証できるようにする", ContainerReleaseSteps[5]),
      MissionStep.run("検証したイメージにリポジトリ向けのタグを付ける", ContainerReleaseSteps[6]),
      MissionStep.run("イメージをrelease-imagesへpushする", ContainerReleaseSteps[7]),
      MissionStep.run("ノード用のサービスアカウントを作る", ContainerReleaseSteps[8]),
      MissionStep.run(
        "自分がノード用SAをクラスタに割り当てられるようにする",
        ContainerReleaseSteps[9],
      ),
      MissionStep.run("ノード用SAにリポジトリの読み取りだけを許可する", ContainerReleaseSteps[10]),
      MissionStep.run("ノード用SAでrelease-gkeを作る", ContainerReleaseSteps[11]),
      MissionStep.run("release-webを2レプリカで起動する", ContainerReleaseSteps[12]),
      MissionStep.run("2つのPodの起動完了を待つ", ContainerReleaseSteps[13]),
      MissionStep.run("release-webを80→8080で公開する", ContainerReleaseSteps[14]),
      MissionStep.run("GKEでの公開を検証して証跡を残す", ContainerReleaseSteps[15]),
      MissionStep.run(
        "片付けでServiceを削除する",
        ContainerReleaseSteps[16],
        "ここからは教材専用のリソースの片付けです。",
      ),
      MissionStep.run("片付けでDeploymentを削除する", ContainerReleaseSteps[17]),
      MissionStep.run("片付けでクラスタを削除する", ContainerReleaseSteps[18]),
      MissionStep.run("片付けでリポジトリを削除する", ContainerReleaseSteps[19]),
      MissionStep.run("片付けでローカルのコンテナを止める", ContainerReleaseSteps[20]),
      MissionStep.run("片付けでローカルのコンテナを削除する", ContainerReleaseSteps[21]),
      MissionStep.run("片付けでリポジトリ向けのタグを外す", ContainerReleaseSteps[22]),
      MissionStep.run("片付けでローカル検証用のタグを外す", ContainerReleaseSteps[23]),
      MissionStep.run("片付けでノード用SAを削除する", ContainerReleaseSteps[24]),
      MissionStep.run("片付けが完了したか確かめる", ContainerReleaseSteps[25]),
    ],
    assertions: [{ kind: "containerReleaseCleaned" }],
  },
];

export const containerReleaseSatisfied = (world: World): boolean => releaseCleanupComplete(world);
