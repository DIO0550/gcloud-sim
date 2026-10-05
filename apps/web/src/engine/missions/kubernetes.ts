import { ContainerLab } from "@/engine/domains/container-lab";
import { ImagePull } from "@/engine/domains/image-pull";
import { KubeRuntime } from "@/engine/domains/kube-config";
import { KubePod } from "@/engine/domains/kubernetes";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";

export type KubernetesAssertion = Readonly<{ kind: "kubeImageUpdated" | "kubeRollbackRecovered" }>;
const image = "us-central1-docker.pkg.dev/ace-dev-01/release-images/hello";
const nodes = "release-nodes@ace-dev-01.iam.gserviceaccount.com";
const setup = [
  { kind: "setPrincipal", principal: F.owner },
  { kind: "setProject", projectId: F.devProjectId },
] as const;
const prepare = [
  "gcloud services enable artifactregistry.googleapis.com container.googleapis.com → gcloud artifacts repositories create release-images --repository-format=docker --location=us-central1（既にあればdescribeで確認）→ gcloud auth configure-docker us-central1-docker.pkg.dev",
  `docker build -t ${image}:v1 ./hello-web → docker push ${image}:v1 → docker build -t ${image}:v2 ./hello-web-v2 → docker push ${image}:v2`,
  `gcloud iam service-accounts create release-nodes → gcloud iam service-accounts add-iam-policy-binding ${nodes} --member=user:owner@example.com --role=roles/iam.serviceAccountUser → gcloud artifacts repositories add-iam-policy-binding release-images --location=us-central1 --member=serviceAccount:${nodes} --role=roles/artifactregistry.reader`,
  `gcloud container clusters create-auto release-gke --region=us-central1 --service-account=${nodes} → kubectl create deployment hello --image=${image}:v1 --replicas=2 → kubectl rollout status deployment/hello。既存クラスタはget-credentialsで選びます。`,
];
export const KubernetesMissions: readonly Mission[] = [
  {
    id: "m-gke-001",
    domain: "デプロイと実装",
    title: "GKEのアプリを新しいイメージへ更新する",
    setup,
    description:
      "release-gkeのhello Deploymentをhello-web v1からv2へ更新し、2レプリカで起動します。以前のv1の履歴を残し、ノードSAに取得権限がある状態にしてください。v2での新規作成だけでは達成しません。",
    hints: [
      ...prepare,
      `kubectl set image deployment/hello hello=${image}:v2 → kubectl rollout status deployment/hello`,
      "kubectl rollout history deployment/hello → kubectl rollout history deployment/hello --revision=1 → kubectl get rs。現在と以前のイメージを確認します。",
    ],
    assertions: [{ kind: "kubeImageUpdated" }],
  },
  {
    id: "m-gke-002",
    domain: "運用の維持",
    title: "失敗したGKEの更新をロールバックする",
    setup,
    description:
      "release-gkeのhelloを存在しないhello:missingへ更新し、ImagePullBackOffを確認します。3レプリカへ変更してから、履歴のv1へロールバックしてください。v1で3レプリカが起動し、失敗した版の履歴も残ると達成です。",
    hints: [
      ...prepare,
      `kubectl set image deployment/hello hello=${image}:missing → kubectl get pods → kubectl describe deployment hello。rollout statusは未起動の理由を返します。`,
      "kubectl scale deployment/hello --replicas=3 → kubectl rollout history deployment/hello。スケールでは新しいイメージの履歴は増えません。",
      "kubectl rollout undo deployment/hello --to-revision=1 → kubectl rollout status deployment/hello → kubectl get deployments。前の演習から続ける場合はhistoryでv1の番号を確認して指定します。undoはイメージを戻し、3レプリカを維持します。",
    ],
    assertions: [{ kind: "kubeRollbackRecovered" }],
  },
];
export const kubernetesSatisfied = (world: World, assertion: KubernetesAssertion): boolean => {
  const cluster = world.clusters.find(
    (c) =>
      c.projectId === F.devProjectId && c.name === "release-gke" && c.nodeServiceAccount === nodes,
  );
  if (!cluster) return false;
  const d = world.kubeDeployments.find(
    (d) =>
      d.projectId === F.devProjectId &&
      d.cluster === cluster.name &&
      d.namespace === "default" &&
      d.name === "hello",
  );
  if (!d || ImagePull.error(world, cluster, d.image)) return false;
  if (KubePod.fromDeployment(d).some((p) => KubeRuntime.error(world, d, p.name))) return false;
  const recipe = assertion.kind === "kubeImageUpdated" ? "hello-web-v2" : "hello-web";
  const tag = assertion.kind === "kubeImageUpdated" ? "v2" : "v1";
  const ref = ContainerLab.registryReference(`${image}:${tag}`);
  if (
    d.image !== ref.canonical ||
    !world.containerLab.registryImages.some(
      (i) =>
        i.repositoryId === ref.repositoryId &&
        i.name === ref.image &&
        i.recipe === recipe &&
        i.tags.includes(tag),
    )
  )
    return false;
  if (assertion.kind === "kubeImageUpdated")
    return (
      d.replicas === 2 &&
      d.revisions.some((r) => r.revision < d.revision && r.image === `${image}:v1`)
    );
  return (
    d.replicas === 3 &&
    d.revisions.at(-1)?.reason === "undo" &&
    d.revisions.some((r) => r.image === `${image}:missing`)
  );
};
