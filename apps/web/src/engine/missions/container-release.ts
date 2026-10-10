import {
  ContainerRelease as L,
  releaseCleanupComplete,
} from "@/engine/domains/container-lab/release";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";

export type ContainerReleaseAssertion = Readonly<{ kind: "containerReleaseCleaned" }>;

/** Reused by the mission acceptance test; each entry is a real lesson step. */
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
    hints: [
      ContainerReleaseSteps.slice(0, 4).join(" → "),
      ContainerReleaseSteps.slice(4, 8).join(" → "),
      ContainerReleaseSteps.slice(8, 12).join(" → "),
      ContainerReleaseSteps.slice(12, 16).join(" → "),
      ContainerReleaseSteps.slice(16, 20).join(" → "),
      ContainerReleaseSteps.slice(20).join(" → "),
    ],
    assertions: [{ kind: "containerReleaseCleaned" }],
  },
];

export const containerReleaseSatisfied = (world: World): boolean => releaseCleanupComplete(world);
