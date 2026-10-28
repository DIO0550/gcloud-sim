import { KubeResources } from "@/engine/domains/kube-resources";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";

export type KubeQosAssertion = Readonly<{ kind: "kubeQosConfigured" }>;
export const KubeQosMissions: readonly Mission[] = [
  {
    id: "m-gke-011",
    domain: "運用の維持",
    title: "requestsとlimitsからPodのQoSを比較する",
    setup: [
      { kind: "setPrincipal", principal: F.owner },
      { kind: "setProject", projectId: F.devProjectId },
    ],
    description:
      "qos-gkeにnginx:1のDeploymentを各1レプリカ作ります。qos-bestはresources未指定、qos-burstはrequests CPU 250m・メモリ128Mi / limits CPU 500m・メモリ256Mi、qos-guaranteedはrequestsとlimitsの両方をCPU 500m・メモリ256Miにしてください。PodのQoSは順にBestEffort・Burstable・Guaranteedになります。QoSは設定から決まる分類で、稼働や性能の保証ではありません。",
    steps: [
      MissionStep.run("GKEのAPIを有効にする", "gcloud services enable container.googleapis.com"),
      MissionStep.run(
        "Standardクラスタqos-gkeを作る",
        "gcloud container clusters create qos-gke --zone=us-central1-a",
        "Standardクラスタで比較します。",
      ),
      MissionStep.run(
        "resources未指定のqos-bestを作る",
        "kubectl create deployment qos-best --image=nginx:1",
      ),
      MissionStep.run(
        "Burstable用のqos-burstを作る",
        "kubectl create deployment qos-burst --image=nginx:1",
      ),
      MissionStep.run(
        "Guaranteed用のqos-guaranteedを作る",
        "kubectl create deployment qos-guaranteed --image=nginx:1",
        "まだ全PodがBestEffortです。",
      ),
      MissionStep.run(
        "全PodのQoSがBestEffortか確かめる",
        "kubectl get pods -o yaml",
        "status.qosClassを確認します。",
      ),
      MissionStep.run(
        "qos-burstに異なるrequestsとlimitsを設定する",
        "kubectl set resources deployment/qos-burst --requests=cpu=250m,memory=128Mi --limits=cpu=500m,memory=256Mi",
        "必要量と上限が異なるためBurstableになります。",
      ),
      MissionStep.run(
        "qos-guaranteedにCPUのlimitを設定する",
        "kubectl set resources deployment/qos-guaranteed --limits=cpu=500m",
        "CPUだけではBurstableです。",
      ),
      MissionStep.run(
        "qos-guaranteedにメモリのlimitを足す",
        "kubectl set resources deployment/qos-guaranteed --limits=memory=256Mi",
        "未指定requestはlimitと同じ量で補完され、CPU・メモリ両方がそろうとGuaranteedになります。",
      ),
      MissionStep.run("各Podのリソース設定を見比べる", "kubectl describe pods"),
      MissionStep.run(
        "3つのPodのQoSクラスを比べる",
        "kubectl get pods -o json",
        "status.qosClassを比較します。ツリーから各Deploymentを選ぶとPod QoSを確認できます。この教材はノード圧迫時の退避やOOM、CPU制限の実行を再現しません。",
      ),
    ],
    assertions: [{ kind: "kubeQosConfigured" }],
  },
];

export const kubeQosSatisfied = (world: World): boolean => {
  const expected: readonly [string, KubeResources][] = [
    ["qos-best", KubeResources.empty()],
    [
      "qos-burst",
      { requests: { cpu: "250m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } },
    ],
    [
      "qos-guaranteed",
      { requests: { cpu: "500m", memory: "256Mi" }, limits: { cpu: "500m", memory: "256Mi" } },
    ],
  ];
  return expected.every(([name, resources]) => {
    const d = world.kubeDeployments.find(
      (d) =>
        d.projectId === F.devProjectId &&
        d.cluster === "qos-gke" &&
        d.namespace === "default" &&
        d.name === name,
    );
    return (
      d?.image === "nginx:1" &&
      d.replicas === 1 &&
      d.env.length === 0 &&
      KubeResources.equal(d.resources, resources)
    );
  });
};
