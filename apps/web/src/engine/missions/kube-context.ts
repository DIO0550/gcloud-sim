import { KubeRuntime } from "@/engine/domains/kube-config";
import { KubeContext } from "@/engine/domains/kube-context";
import { KubePod } from "@/engine/domains/kubernetes";
import { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";
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
    steps: [
      MissionStep.run(
        "Kubernetes Engine APIを有効にする",
        "gcloud services enable container.googleapis.com",
      ),
      MissionStep.run(
        "zonalクラスタを作る",
        "gcloud container clusters create context-gke --zone=us-central1-a",
      ),
      MissionStep.run("検証用のnamespaceを作る", "kubectl create namespace staging"),
      MissionStep.run("本番用のnamespaceを作る", "kubectl create namespace production"),
      MissionStep.run(
        "検証環境にwebを配置する",
        "kubectl create deployment web --image=nginx:1 -n staging",
      ),
      MissionStep.run(
        "本番環境にwebを配置する",
        "kubectl create deployment web --image=nginx:1 -n production",
        "最初はkubectl get deploymentsがdefaultを対象にするため空です。",
      ),
      MissionStep.run(
        "既定namespaceをstagingへ切り替える",
        "kubectl config set-context --current --namespace=staging",
      ),
      MissionStep.run(
        "コンテキストの既定namespaceを確かめる",
        "kubectl config get-contexts",
        "NAMESPACE列と端末見出しで作業先を確認します。",
      ),
      MissionStep.run(
        "検証環境のwebをnginx:2へ更新する",
        "kubectl set image deployment/web web=nginx:2",
      ),
      MissionStep.run(
        "検証環境のwebを2レプリカにする",
        "kubectl scale deployment/web --replicas=2",
        "-nを省略してもstagingだけが変わります。",
      ),
      MissionStep.run(
        "本番のwebが変わっていないか確かめる",
        "kubectl get deployment web -n production -o json",
      ),
      MissionStep.run(
        "既定namespaceをproductionへ切り替える",
        "kubectl config set-context --current --namespace=production",
      ),
      MissionStep.run(
        "本番のwebが元のままか確かめる",
        "kubectl get deployment web -o json",
        "本番がnginx:1・1レプリカ・revision 1なら達成です。",
      ),
      MissionStep.run("両環境のwebを見比べる", "kubectl get deployments -A"),
      MissionStep.run(
        "コンテキストに保存された既定namespaceを確かめる",
        "kubectl config view",
        "クラスタを切り替えてもコンテキストごとのnamespaceを保持します。",
      ),
      MissionStep.say(
        "既定namespaceの解除はクリア後に試す",
        "kubectl config set-context --current --namespace=''で指定を解除するとdefaultへ戻ります。解除の練習はクリア後に行います。",
      ),
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
