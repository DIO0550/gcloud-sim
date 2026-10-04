import { ContainerLab } from "@/engine/domains/container-lab";
import { ImagePull } from "@/engine/domains/image-pull";
import { KubeLabels } from "@/engine/domains/kube-labels";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
export type BuildAssertion =
  | Readonly<{ kind: "cloudBuildPublished" }>
  | Readonly<{ kind: "registryDeploymentReady" }>;
const image = "us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v1";
const setup = [
  { kind: "setPrincipal", principal: F.owner },
  { kind: "setProject", projectId: F.devProjectId },
] as const;
const hints = [
  "gcloud services enable cloudbuild.googleapis.com artifactregistry.googleapis.com container.googleapis.com → gcloud artifacts repositories create ace-images --repository-format=docker --location=us-central1",
  "gcloud iam service-accounts create ace-builder → gcloud artifacts repositories add-iam-policy-binding ace-images --location=us-central1 --member=serviceAccount:ace-builder@ace-dev-01.iam.gserviceaccount.com --role=roles/artifactregistry.writer",
  "gcloud iam service-accounts add-iam-policy-binding ace-builder@ace-dev-01.iam.gserviceaccount.com --member=user:owner@example.com --role=roles/iam.serviceAccountUser（ビルド依頼者のactAs権限）",
  `gcloud builds submit ./hello-web --tag=${image} --service-account=projects/ace-dev-01/serviceAccounts/ace-builder@ace-dev-01.iam.gserviceaccount.com --region=us-central1 → gcloud builds list --region=us-central1。FAILUREならlogで理由を確認して再submitします。`,
];
export const BuildMissions: readonly Mission[] = [
  {
    id: "m-builds-001",
    domain: "デプロイと実装",
    title: "Cloud Buildでイメージをビルドする",
    setup,
    description:
      "ace-builderサービスアカウントに書き込み権限を付与し、Cloud Buildでhello-webをビルドしてace-imagesのhello:v1へ登録します。ローカルでのdocker pushだけでは達成になりません。",
    hints,
    assertions: [{ kind: "cloudBuildPublished" }],
  },
  {
    id: "m-builds-002",
    domain: "デプロイと実装",
    title: "ビルドしたイメージをGKEへデプロイする",
    setup,
    description:
      "Cloud Buildでhello:v1を登録し、ace-gkeのhello Deploymentを2レプリカで起動してLoadBalancer Service（80→8080）で公開します。ビルド用とノード用のサービスアカウントを分け、ノードにReader権限を設定します。ImagePullBackOffや未公開では達成しません。",
    hints: [
      ...hints,
      "gcloud iam service-accounts create ace-nodes → gcloud iam service-accounts add-iam-policy-binding ace-nodes@ace-dev-01.iam.gserviceaccount.com --member=user:owner@example.com --role=roles/iam.serviceAccountUser → gcloud container clusters create-auto ace-gke --region=us-central1 --service-account=ace-nodes@ace-dev-01.iam.gserviceaccount.com",
      `kubectl create deployment hello --image=${image} --replicas=2 → kubectl get pods。ノードに取得権限がないとImagePullBackOffになります。`,
      "gcloud artifacts repositories add-iam-policy-binding ace-images --location=us-central1 --member=serviceAccount:ace-nodes@ace-dev-01.iam.gserviceaccount.com --role=roles/artifactregistry.reader → kubectl rollout status deployment/hello",
      "kubectl expose deployment hello --type=LoadBalancer --port=80 --target-port=8080 → kubectl get all。完了後の片付け: kubectl delete service hello → kubectl delete deployment hello → gcloud container clusters delete ace-gke --region=us-central1 → gcloud artifacts repositories delete ace-images --location=us-central1。",
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
        d.name === "hello" &&
        d.image === image &&
        d.replicas === 2,
    ) &&
    world.kubeServices.some(
      (s) =>
        s.projectId === cluster.projectId &&
        s.cluster === cluster.name &&
        s.name === "hello" &&
        KubeLabels.equal(s.selector, { app: "hello" }) &&
        s.type === "LoadBalancer" &&
        s.port === 80 &&
        s.targetPort === 8080,
    )
  );
};
