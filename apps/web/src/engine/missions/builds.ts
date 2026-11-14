import { ContainerLab } from "@/engine/domains/container-lab";
import { ImagePull } from "@/engine/domains/image-pull";
import { KubeLabels } from "@/engine/domains/kube-labels";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";
export type BuildAssertion =
  | Readonly<{ kind: "cloudBuildPublished" }>
  | Readonly<{ kind: "registryDeploymentReady" }>;
const image = "us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v1";
const setup = [
  { kind: "setPrincipal", principal: F.owner },
  { kind: "setProject", projectId: F.devProjectId },
] as const;
/** 両ミッション共通の、リポジトリ作成からCloud Buildでの登録まで。 */
const buildSteps: readonly MissionStep[] = [
  MissionStep.run(
    "Cloud Build・Artifact Registry・GKEのAPIを有効にする",
    "gcloud services enable cloudbuild.googleapis.com artifactregistry.googleapis.com container.googleapis.com",
  ),
  MissionStep.run(
    "Dockerリポジトリace-imagesを作る",
    "gcloud artifacts repositories create ace-images --repository-format=docker --location=us-central1",
  ),
  MissionStep.run(
    "ビルド用のサービスアカウントを作る",
    "gcloud iam service-accounts create ace-builder",
  ),
  MissionStep.run(
    "ビルド用SAにリポジトリへの書き込みを許可する",
    "gcloud artifacts repositories add-iam-policy-binding ace-images --location=us-central1 --member=serviceAccount:ace-builder@ace-dev-01.iam.gserviceaccount.com --role=roles/artifactregistry.writer",
  ),
  MissionStep.run(
    "自分がビルド用SAとして実行できるようにする",
    "gcloud iam service-accounts add-iam-policy-binding ace-builder@ace-dev-01.iam.gserviceaccount.com --member=user:owner@example.com --role=roles/iam.serviceAccountUser",
    "ビルド依頼者のactAs権限です。",
  ),
  MissionStep.run(
    "Cloud Buildでhello-webをビルドしてhello:v1に登録する",
    `gcloud builds submit ./hello-web --tag=${image} --service-account=projects/ace-dev-01/serviceAccounts/ace-builder@ace-dev-01.iam.gserviceaccount.com --region=us-central1`,
  ),
  MissionStep.run(
    "ビルドの結果を確かめる",
    "gcloud builds list --region=us-central1",
    "FAILUREならlogで理由を確認して再submitします。",
  ),
];
export const BuildMissions: readonly Mission[] = [
  {
    id: "m-builds-001",
    domain: "デプロイと実装",
    title: "Cloud Buildでイメージをビルドする",
    setup,
    description:
      "ace-builderサービスアカウントに書き込み権限を付与し、Cloud Buildでhello-webをビルドしてace-imagesのhello:v1へ登録します。ローカルでのdocker pushだけでは達成になりません。",
    steps: buildSteps,
    assertions: [{ kind: "cloudBuildPublished" }],
  },
  {
    id: "m-builds-002",
    domain: "デプロイと実装",
    title: "ビルドしたイメージをGKEへデプロイする",
    setup,
    description:
      "Cloud Buildでhello:v1を登録し、ace-gkeのhello Deploymentを2レプリカで起動してLoadBalancer Service（80→8080）で公開します。ビルド用とノード用のサービスアカウントを分け、ノードにReader権限を設定します。ImagePullBackOffや未公開では達成しません。",
    steps: [
      ...buildSteps,
      MissionStep.run(
        "ノード用のサービスアカウントを作る",
        "gcloud iam service-accounts create ace-nodes",
      ),
      MissionStep.run(
        "自分がノード用SAをクラスタに割り当てられるようにする",
        "gcloud iam service-accounts add-iam-policy-binding ace-nodes@ace-dev-01.iam.gserviceaccount.com --member=user:owner@example.com --role=roles/iam.serviceAccountUser",
      ),
      MissionStep.run(
        "ノード用SAでAutopilotクラスタace-gkeを作る",
        "gcloud container clusters create-auto ace-gke --region=us-central1 --service-account=ace-nodes@ace-dev-01.iam.gserviceaccount.com",
      ),
      MissionStep.run(
        "登録したイメージでhelloを2レプリカ起動する",
        `kubectl create deployment hello --image=${image} --replicas=2`,
      ),
      MissionStep.run(
        "イメージを取得できずに止まっているか確かめる",
        "kubectl get pods",
        "ノードに取得権限がないとImagePullBackOffになります。",
      ),
      MissionStep.run(
        "ノード用SAにリポジトリの読み取りを許可する",
        "gcloud artifacts repositories add-iam-policy-binding ace-images --location=us-central1 --member=serviceAccount:ace-nodes@ace-dev-01.iam.gserviceaccount.com --role=roles/artifactregistry.reader",
      ),
      MissionStep.run("2つのPodの起動完了を待つ", "kubectl rollout status deployment/hello"),
      MissionStep.run(
        "helloを80→8080のLoadBalancerで公開する",
        "kubectl expose deployment hello --type=LoadBalancer --port=80 --target-port=8080",
      ),
      MissionStep.run("Deployment・Pod・Serviceをまとめて確かめる", "kubectl get all"),
      MissionStep.run(
        "片付けでServiceを削除する",
        "kubectl delete service hello",
        "ここからは完了後の片付けです。",
      ),
      MissionStep.run("片付けでDeploymentを削除する", "kubectl delete deployment hello"),
      MissionStep.run(
        "片付けでクラスタを削除する",
        "gcloud container clusters delete ace-gke --region=us-central1",
      ),
      MissionStep.run(
        "片付けでリポジトリを削除する",
        "gcloud artifacts repositories delete ace-images --location=us-central1",
      ),
    ],
    assertions: [{ kind: "cloudBuildPublished" }, { kind: "registryDeploymentReady" }],
  },
];
export const buildSatisfied = (world: World, assertion: BuildAssertion): boolean => {
  if (assertion.kind === "cloudBuildPublished")
    return (
      world.containerLab.builds.some(
        (b) =>
          b.serviceAccount === "ace-builder@ace-dev-01.iam.gserviceaccount.com" &&
          b.projectId === F.devProjectId &&
          b.region === "us-central1" &&
          b.tag === image &&
          b.status === "SUCCESS" &&
          b.digest === ContainerLab.digest("hello-web"),
      ) &&
      world.containerLab.registryImages.some(
        (i) =>
          i.repositoryId ===
            ContainerLab.repositoryId(F.devProjectId, "us-central1", "ace-images") &&
          i.name === "hello" &&
          i.recipe === "hello-web" &&
          i.tags.includes("v1"),
      )
    );
  const cluster = world.clusters.find(
    (c) =>
      c.projectId === F.devProjectId &&
      c.name === "ace-gke" &&
      c.location === "us-central1" &&
      c.nodeServiceAccount === "ace-nodes@ace-dev-01.iam.gserviceaccount.com",
  );
  if (!cluster || ImagePull.error(world, cluster, image)) return false;
  return (
    world.kubeDeployments.some(
      (d) =>
        d.projectId === cluster.projectId &&
        d.cluster === cluster.name &&
        d.namespace === "default" &&
        d.name === "hello" &&
        d.image === image &&
        d.replicas === 2,
    ) &&
    world.kubeServices.some(
      (s) =>
        s.projectId === cluster.projectId &&
        s.cluster === cluster.name &&
        s.namespace === "default" &&
        s.name === "hello" &&
        KubeLabels.equal(s.selector, { app: "hello" }) &&
        s.type === "LoadBalancer" &&
        s.port === 80 &&
        s.targetPort === 8080,
    )
  );
};
