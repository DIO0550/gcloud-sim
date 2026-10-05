import { KubeRuntime } from "@/engine/domains/kube-config";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import { KubeStorage } from "@/engine/domains/kube-storage";
import { KubeVolumes } from "@/engine/domains/kube-volume";
import { KubePod } from "@/engine/domains/kubernetes";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { Result } from "@/utils/Result";

export type KubeStorageAssertion = Readonly<{
  kind: "kubePersistentDataReady" | "kubeRetainedDataReady";
}>;
const setup = [
  { kind: "setPrincipal", principal: F.owner },
  { kind: "setProject", projectId: F.devProjectId },
] as const;
export const KubeStorageMissions: readonly Mission[] = [
  {
    id: "m-gke-022",
    domain: "運用の維持",
    title: "PVCを割り当てて再起動後もデータを保つ",
    setup,
    description:
      "storage-gkeへPVC app-dataとstorage-webを配置すると、StorageClass archiveの欠落でPodはFailedMountとなります。archive-class.yamlをapplyして割り当てを復旧し、要求容量を1Giから2Giへ拡張してください。教材用のwrite-fileで/data/message.txtへsurvives-restartを書き、rollout restart後も同じPVと内容を保持したnginx:1・1 PodをReadyにします。",
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create-auto storage-gke --region=us-central1 → sim files load kubernetes-storage",
      "kubectl apply -f storage-claim.yaml → kubectl apply -f storage-web.yaml → kubectl describe pvc app-data → kubectl get pods。StorageClass archiveが欠落しています。",
      "kubectl apply -f archive-class.yaml → kubectl get sc → kubectl get pvc → kubectl get pv。WaitForFirstConsumerは利用Podの作成後に割り当てます。",
      "sim files replace storage-claim.yaml --search=1Gi --replacement=2Gi → kubectl apply -f storage-claim.yaml。allowVolumeExpansionがtrueなら容量を増やせます。縮小はできません。",
      "sim kubernetes write-file storage-web --path=/data/message.txt --content=survives-restart → kubectl exec deployment/storage-web -- cat /data/message.txt。アプリ書き込みを模擬する教材操作です。",
      "kubectl rollout restart deployment/storage-web → kubectl rollout status deployment/storage-web → kubectl exec deployment/storage-web -- cat /data/message.txt → kubectl get pvc → kubectl get pv。Pod名は変わってもPVと内容は残ります。",
    ],
    assertions: [{ kind: "kubePersistentDataReady" }],
  },
  {
    id: "m-gke-023",
    domain: "運用の維持",
    title: "PVC削除後にRetainでデータを残す",
    setup,
    description:
      "retain-gkeへarchive-class・app-data・storage-webを配置し、/data/message.txtへkeep-meを書きます。利用中のPVCを削除するとTerminatingで保護されます。storage-webを0レプリカにしてPodを取り除き、PVCを削除完了させてください。Retainを持つPVがReleasedとなり、ファイルを保持していることを確認します。Released PVの手動再利用は対象外です。",
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create-auto retain-gke --region=us-central1 → sim files load kubernetes-storage",
      "kubectl apply -f archive-class.yaml → kubectl apply -f storage-claim.yaml → kubectl get pvc。まだ利用PodがなくPendingです。",
      "kubectl apply -f storage-web.yaml → kubectl get pvc → sim kubernetes write-file storage-web --path=/data/message.txt --content=keep-me → kubectl exec deployment/storage-web -- cat /data/message.txt",
      "kubectl delete pvc app-data → kubectl get pvc。利用Podが残る間はTerminatingで、PVとデータは削除されません。",
      "kubectl scale deployment/storage-web --replicas=0 → kubectl get pvc → kubectl get pv。PVのSTATUSはReleased、RECLAIM POLICYはRetainです。ツリーのpvを選ぶとmessage.txtの7 bytesを確認できます。",
    ],
    assertions: [{ kind: "kubeRetainedDataReady" }],
  },
];
export const kubeStorageSatisfied = (world: World, retained: boolean): boolean => {
  const cluster = retained ? "retain-gke" : "storage-gke";
  const scoped = (r: { projectId: string; cluster: string }) =>
    r.projectId === F.devProjectId && r.cluster === cluster;
  const d = world.kubeDeployments.find(
    (d) => scoped(d) && d.namespace === "default" && d.name === "storage-web",
  );
  if (d?.image !== "nginx:1" || d.replicas !== (retained ? 0 : 1)) return false;
  const sc = world.kubeStorageClasses.find((s) => scoped(s) && s.name === "archive");
  if (
    sc?.reclaimPolicy !== "Retain" ||
    sc.bindingMode !== "WaitForFirstConsumer" ||
    !sc.allowVolumeExpansion
  )
    return false;
  const parse = (path: string) =>
    Result.unwrapOr(KubeManifest.parse(world.kubeFiles[path] ?? ""), []);
  const classFile = parse("archive-class.yaml");
  if (
    classFile.length !== 1 ||
    classFile[0]?.kind !== "storageclass" ||
    classFile[0].name !== sc.name ||
    classFile[0].reclaimPolicy !== sc.reclaimPolicy ||
    classFile[0].bindingMode !== sc.bindingMode ||
    classFile[0].diskType !== sc.diskType ||
    !classFile[0].allowVolumeExpansion
  )
    return false;
  const deploymentFile = parse("storage-web.yaml")[0];
  if (
    deploymentFile?.kind !== "deployment" ||
    deploymentFile.name !== d.name ||
    (deploymentFile.namespace !== undefined && deploymentFile.namespace !== "default") ||
    !KubeVolumes.equal(deploymentFile, d) ||
    d.volumes.length !== 1 ||
    d.volumes[0]?.source !== "persistentvolumeclaim" ||
    d.volumes[0].resource !== "app-data" ||
    d.volumes[0].sourceReadOnly ||
    d.volumeMounts.length !== 1 ||
    d.volumeMounts[0]?.mountPath !== "/data" ||
    d.volumeMounts[0].subPath ||
    d.volumeMounts[0].readOnly
  )
    return false;
  const c = world.kubePvcs.find(
    (c) => scoped(c) && c.namespace === "default" && c.name === "app-data",
  );
  const p = retained
    ? world.kubePvs.find(
        (p) =>
          scoped(p) &&
          p.released &&
          p.namespace === "default" &&
          p.claim === "app-data" &&
          p.storageClassName === "archive",
      )
    : KubeStorage.volume(world, d, "app-data");
  if (p?.reclaimPolicy !== "Retain" || p.storageGi !== (retained ? 1 : 2)) return false;
  const f = p.files.find((f) => f.path === "message.txt");
  if (
    !f ||
    Result.unwrapOr(KubeVolumes.content(f), "") !== (retained ? "keep-me" : "survives-restart")
  )
    return false;
  if (retained) return !c;
  const claimFile = parse("storage-claim.yaml");
  if (
    !c ||
    c.deleting ||
    c.storageGi !== 2 ||
    c.storageClassName !== "archive" ||
    claimFile.length !== 1 ||
    claimFile[0]?.kind !== "pvc" ||
    claimFile[0].name !== c.name ||
    claimFile[0].storageGi !== c.storageGi ||
    claimFile[0].storageClassName !== c.storageClassName ||
    (claimFile[0].namespace !== undefined && claimFile[0].namespace !== "default")
  )
    return false;
  return (
    d.revisions.some((r) => r.reason === "restart") &&
    KubePod.fromDeployment(d).every((p) => p.ready && !KubeRuntime.error(world, d, p.name))
  );
};
