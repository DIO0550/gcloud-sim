import { KubeRuntime } from "@/engine/domains/kube-config";
import { KubeContext } from "@/engine/domains/kube-context";
import { KubePod } from "@/engine/domains/kubernetes";
import { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export type KubeContextAssertion = Readonly<{ kind: "kubeContextSwitched" }>;
export const KubeContextMissions: readonly Mission[] = [
  {
    id: "m-gke-016",
    domain: "運用の維持",
    title: "コンテキストの既定namespaceを切り替える",
    setup: [
      { kind: "setPrincipal", principal: F.owner },
      { kind: "setProject", projectId: F.devProjectId },
    ],
    description:
      "context-gkeにstagingとproductionを作り、両方にnginx:1・1レプリカのwebを配置します。既定namespaceをstagingへ切り替え、検証環境だけnginx:2・2レプリカへ更新してください。本番のイメージ・1レプリカ・revision 1を保ち、最後はproductionを既定namespaceとして選びます。明示した-nは既定値より優先します。",
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create context-gke --zone=us-central1-a → kubectl create namespace staging → kubectl create namespace production",
      "kubectl create deployment web --image=nginx:1 -n staging → kubectl create deployment web --image=nginx:1 -n production。最初はkubectl get deploymentsがdefaultを対象にするため空です。",
      "kubectl config set-context --current --namespace=staging → kubectl config get-contexts。NAMESPACE列と端末見出しで作業先を確認します。",
      "kubectl set image deployment/web web=nginx:2 → kubectl scale deployment/web --replicas=2。-nを省略してもstagingだけが変わります。kubectl get deployment web -n production -o jsonで本番を確認します。",
      "kubectl config set-context --current --namespace=production → kubectl get deployment web -o json。本番がnginx:1・1レプリカ・revision 1なら達成。kubectl get deployments -Aで両環境を比べられます。",
      "クラスタを切り替えてもコンテキストごとのnamespaceを保持します。kubectl config viewで設定を確認でき、kubectl config set-context --current --namespace=''で指定を解除するとdefaultへ戻ります。解除の練習はクリア後に行います。",
    ],
    assertions: [{ kind: "kubeContextSwitched" }],
  },
];

export const kubeContextSatisfied = (world: World): boolean => {
  if (Option.unwrapOr(World.currentProjectId(world), "") !== F.devProjectId) return false;
  const cluster = KubeContext.current(world, F.devProjectId);
  if (!Option.isSome(cluster) || cluster.value.name !== "context-gke") return false;
  if (KubeContext.namespace(world, cluster.value) !== "production") return false;
  const staging = World.findKubeDeployment(world, cluster.value, "web", "staging");
  const production = World.findKubeDeployment(world, cluster.value, "web", "production");
  if (!Option.isSome(staging) || !Option.isSome(production)) return false;
  return (
    staging.value.image === "nginx:2" &&
    staging.value.replicas === 2 &&
    production.value.image === "nginx:1" &&
    production.value.replicas === 1 &&
    production.value.revision === 1 &&
    [staging.value, production.value].every((d) =>
      KubePod.fromDeployment(d).every(
        (p) => p.ready && Result.isOk(KubeRuntime.environment(world, d, p.name)),
      ),
    )
  );
};
