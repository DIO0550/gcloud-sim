import { KubeResources } from "@/engine/domains/kube-resources";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";

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
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create qos-gke --zone=us-central1-a。Standardクラスタで比較します。",
      "kubectl create deployment qos-best --image=nginx:1 → kubectl create deployment qos-burst --image=nginx:1 → kubectl create deployment qos-guaranteed --image=nginx:1。まだ全PodがBestEffortです。kubectl get pods -o yamlのstatus.qosClassを確認します。",
      "kubectl set resources deployment/qos-burst --requests=cpu=250m,memory=128Mi --limits=cpu=500m,memory=256Mi。必要量と上限が異なるためBurstableになります。",
      "kubectl set resources deployment/qos-guaranteed --limits=cpu=500m。CPUだけではBurstableです。続いてkubectl set resources deployment/qos-guaranteed --limits=memory=256Mi。未指定requestはlimitと同じ量で補完され、CPU・メモリ両方がそろうとGuaranteedになります。",
      "kubectl describe pods → kubectl get pods -o json。status.qosClassを比較します。ツリーから各Deploymentを選ぶとPod QoSを確認できます。この教材はノード圧迫時の退避やOOM、CPU制限の実行を再現しません。",
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
      (d) => d.projectId === F.devProjectId && d.cluster === "qos-gke" && d.name === name,
    );
    return (
      d?.image === "nginx:1" &&
      d.replicas === 1 &&
      d.env.length === 0 &&
      KubeResources.equal(d.resources, resources)
    );
  });
};
