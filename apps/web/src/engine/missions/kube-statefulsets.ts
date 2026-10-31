import { KubeRuntime } from "@/engine/domains/kube-config";
import { KubeLabels } from "@/engine/domains/kube-labels";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import { KubeStatefulSet } from "@/engine/domains/kube-statefulset";
import { KubeStorage } from "@/engine/domains/kube-storage";
import { KubeVolumes } from "@/engine/domains/kube-volume";
import { KubePod } from "@/engine/domains/kubernetes";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";
import { Result } from "@/utils/Result";

export type StatefulAssertion = Readonly<{
  kind: "kubeStatefulPodRecovered" | "kubeStatefulScaleRecovered";
}>;
const setup = [
  { kind: "setPrincipal", principal: F.owner },
  { kind: "setProject", projectId: F.devProjectId },
] as const;
/** 両ミッション共通の、クラスタ作成から2つのPodへの書き込みまで。 */
const sharedSteps = (cluster: string): readonly MissionStep[] => [
  MissionStep.run("GKEのAPIを有効にする", "gcloud services enable container.googleapis.com"),
  MissionStep.run(
    `Autopilotクラスタ${cluster}を作る`,
    `gcloud container clusters create-auto ${cluster} --region=us-central1`,
  ),
  MissionStep.run(
    "StatefulSet教材のマニフェストを用意する",
    "sim files load kubernetes-statefulset",
  ),
  MissionStep.run("headless Service notes-peersを作る", "kubectl apply -f stateful-service.yaml"),
  MissionStep.run("2レプリカのStatefulSet notesを作る", "kubectl apply -f stateful-notes.yaml"),
  MissionStep.run("StatefulSetの準備状況を確かめる", "kubectl get sts"),
  MissionStep.run("連番のPod notes-0/notes-1を確かめる", "kubectl get pods"),
  MissionStep.run(
    "Podごとに別のPVCが付いたか確かめる",
    "kubectl get pvc",
    "notes-0/notes-1にdata-notes-0/data-notes-1を個別に割り当てます。",
  ),
  MissionStep.run(
    "notes-0のボリュームにfirst-noteを書く",
    "sim kubernetes write-file pod/notes-0 --path=/data/note.txt --content=first-note",
  ),
  MissionStep.run(
    "notes-1のボリュームにsecond-noteを書く",
    "sim kubernetes write-file pod/notes-1 --path=/data/note.txt --content=second-note",
    "連番ごとのデータは独立しています。",
  ),
];

export const StatefulMissions: readonly Mission[] = [
  {
    id: "m-gke-032",
    domain: "運用の維持",
    title: "StatefulSetのPodを同じPVCで復旧する",
    setup,
    description:
      "stateful-gkeへheadless Service notes-peersと2レプリカのStatefulSet notesを配置します。notes-0/notes-1の/data/note.txtへfirst-note/second-noteをそれぞれ保存し、notes-0だけを削除してください。同じ名前・PVC・内容で復旧し、notes-1は作り直さずReadyを保ちます。実DNSやアプリのレプリケーションは再現しません。",
    steps: [
      ...sharedSteps("stateful-gke"),
      MissionStep.run("notes-0だけを削除する", "kubectl delete pod notes-0"),
      MissionStep.run("notes-0が同じ名前で作り直されたか確かめる", "kubectl get pods"),
      MissionStep.run(
        "PVCが残っているか確かめる",
        "kubectl get pvc",
        "Deploymentと違ってPod名は変わらず、PVは保持されます。",
      ),
      MissionStep.run(
        "復旧したnotes-0の内容を確かめる",
        "kubectl exec notes-0 -- cat /data/note.txt",
      ),
      MissionStep.run(
        "notes-1の内容が変わっていないか確かめる",
        "kubectl exec notes-1 -- cat /data/note.txt",
      ),
      MissionStep.run(
        "Pod世代とPVCの対応を確かめる",
        "kubectl describe sts notes",
        "ツリーのsts: notesでPod世代とPVCを確認できます。",
      ),
    ],
    assertions: [{ kind: "kubeStatefulPodRecovered" }],
  },
  {
    id: "m-gke-033",
    domain: "運用の維持",
    title: "StatefulSetのスケール後にPVCを再利用する",
    setup,
    description:
      "stateful-scale-gkeへnotes-peersと2レプリカのnotesを配置し、notes-0/notes-1のnote.txtへfirst-note/second-noteを保存します。1レプリカへ減らすとnotes-1は消えますがPVCは残ります。2レプリカへ戻してnotes-1の同じPVとsecond-noteを再利用し、notes-0を維持してください。StorageClassのDeleteとStatefulSetのPVC保持は別の設定です。",
    steps: [
      ...sharedSteps("stateful-scale-gke"),
      MissionStep.run("notesを1レプリカに減らす", "kubectl scale sts/notes --replicas=1"),
      MissionStep.run("notes-1が消えたか確かめる", "kubectl get pods"),
      MissionStep.run(
        "notes-1のPVCが残っているか確かめる",
        "kubectl get pvc",
        "data-notes-1はBoundのまま残り、PVと内容も保持します。",
      ),
      MissionStep.run("notesを2レプリカに戻す", "kubectl scale sts/notes --replicas=2"),
      MissionStep.run(
        "notes-1がsecond-noteを読めるか確かめる",
        "kubectl exec notes-1 -- cat /data/note.txt",
      ),
      MissionStep.run(
        "notes-0の内容が保たれているか確かめる",
        "kubectl exec notes-0 -- cat /data/note.txt",
      ),
      MissionStep.run(
        "スケールで再利用したPVC/PVを確かめる",
        "kubectl describe sts notes",
        "1→2のスケールと再利用したPVC/PVを確認します。",
      ),
    ],
    assertions: [{ kind: "kubeStatefulScaleRecovered" }],
  },
];

export const statefulSatisfied = (world: World, scale: boolean): boolean => {
  const cluster = scale ? "stateful-scale-gke" : "stateful-gke";
  const s = world.kubeStatefulSets.find(
    (s) =>
      s.projectId === F.devProjectId &&
      s.cluster === cluster &&
      s.namespace === "default" &&
      s.name === "notes",
  );

  if (
    s?.image !== "nginx:1" ||
    s.replicas !== 2 ||
    s.statefulSet.serviceName !== "notes-peers" ||
    !KubeStatefulSet.networkReason(world, s).startsWith("Headless Service configured")
  )
    return false;

  const t = s.statefulSet.volumeClaimTemplates;
  if (
    t.length !== 1 ||
    t[0]?.name !== "data" ||
    t[0].storageClassName !== "standard-rwo" ||
    t[0].storageGi !== 1 ||
    s.volumeMounts.length !== 1 ||
    s.volumeMounts[0]?.mountPath !== "/data" ||
    s.volumeMounts[0].readOnly
  )
    return false;

  const manifest = Result.unwrapOr(
    KubeManifest.parse(world.kubeFiles["stateful-notes.yaml"] ?? ""),
    [],
  )[0];
  const service = Result.unwrapOr(
    KubeManifest.parse(world.kubeFiles["stateful-service.yaml"] ?? ""),
    [],
  )[0];
  const liveService = world.kubeServices.find(
    (v) =>
      v.projectId === s.projectId &&
      v.cluster === s.cluster &&
      v.namespace === s.namespace &&
      v.name === "notes-peers",
  );

  if (
    manifest?.kind !== "statefulset" ||
    manifest.name !== s.name ||
    manifest.image !== s.image ||
    manifest.replicas !== s.replicas ||
    manifest.statefulSet.serviceName !== s.statefulSet.serviceName ||
    (manifest.namespace !== undefined && manifest.namespace !== "default") ||
    !KubeVolumes.equal(manifest, s) ||
    !KubeLabels.equal(manifest.selector, s.selector) ||
    !KubeLabels.equal(manifest.podLabels, s.podLabels) ||
    JSON.stringify(manifest.statefulSet.volumeClaimTemplates) !== JSON.stringify(t) ||
    service?.kind !== "service" ||
    service.name !== "notes-peers" ||
    !service.headless ||
    (service.namespace !== undefined && service.namespace !== "default") ||
    !liveService ||
    !KubeLabels.equal(service.selector, liveService.selector) ||
    service.port !== liveService.port ||
    service.targetPort !== liveService.targetPort
  )
    return false;
  for (let i = 0; i < 2; i += 1) {
    const claimName = KubeStatefulSet.claimName("data", s.name, i);
    const c = world.kubePvcs.find(
      (c) =>
        c.projectId === s.projectId &&
        c.cluster === s.cluster &&
        c.namespace === s.namespace &&
        c.name === claimName,
    );
    const pv = KubeStorage.volume(world, s, claimName);
    const file = pv?.files.find((f) => f.path === "note.txt");
    if (
      !c ||
      c.deleting ||
      c.storageGi !== 1 ||
      c.storageClassName !== "standard-rwo" ||
      !file ||
      Result.unwrapOr(KubeVolumes.content(file), "") !== (i === 0 ? "first-note" : "second-note")
    )
      return false;
  }
  if (!KubePod.fromDeployment(s).every((p) => !KubeRuntime.error(world, s, p.name))) return false;
  if (!scale) return (s.podIncarnations[0] ?? 0) > 0 && s.podIncarnations[1] === 0;
  const history = s.statefulSet.lastScale;
  const pv = KubeStorage.volume(world, s, "data-notes-1");
  return (
    s.podIncarnations[0] === 0 &&
    (s.podIncarnations[1] ?? 0) > 0 &&
    history?.from === 1 &&
    history.to === 2 &&
    history.reusedClaims.some((c) => c.name === "data-notes-1" && c.volumeName === pv?.name) ===
      true
  );
};
