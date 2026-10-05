import { KubeIngress } from "@/engine/domains/kube-ingress";
import { KubeManifest } from "@/engine/domains/kube-manifest";
import { KubeServiceRouting } from "@/engine/domains/kube-service-routing";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export type KubeIngressAssertion = Readonly<{ kind: "kubeIngressRouted" | "kubeIngressRecovered" }>;
const setup = [
  { kind: "setPrincipal", principal: F.owner },
  { kind: "setProject", projectId: F.devProjectId },
] as const;
export const KubeIngressMissions: readonly Mission[] = [
  {
    id: "m-gke-026",
    domain: "デプロイと実装",
    title: "Ingressでホストとパスを振り分ける",
    setup,
    description:
      "ingress-gkeで3つのNodePort Serviceを起動します。ingress-routes.jsonの参照先を直し、app.example.testの/をweb、/api以下をapi、/api/healthの完全一致をhealthへ振り分けてください。/apixはweb、別ホストは未一致のままにします。",
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create-auto ingress-gke --region=us-central1 → sim files load kubernetes-ingress → kubectl apply -f ingress-workloads.yaml → kubectl apply -f ingress-routes.json",
      "kubectl describe ing app-entry → sim kubernetes request app-entry --host=app.example.test --path=/api/users。存在しないServiceを確認します。",
      "sim files replace ingress-routes.json --search=wrong-api --replacement=api → kubectl apply -f ingress-routes.json",
      "sim kubernetes request app-entry --host=app.example.test --path=/api/health → sim kubernetes request app-entry --host=app.example.test --path=/api/health/detail。Exactと最長Prefixの違いを確認します。",
      "sim kubernetes request app-entry --host=app.example.test --path=/apix → sim kubernetes request app-entry --host=other.example.test --path=/ → kubectl get ing。Prefixは文字列だけでなくパス要素単位で一致します。",
    ],
    assertions: [{ kind: "kubeIngressRouted" }],
  },
  {
    id: "m-gke-027",
    domain: "運用の維持",
    title: "IngressからReadyなService接続先を復旧する",
    setup,
    description:
      "ingress-fix-gkeでrecovery-entryを復旧します。Ingressが参照するService port、Service selector、Pod readinessを順に確認し、ファイルのポートとラベルを修正してapply、readinessを成功させてください。Service portは80、targetPortは8080、Readyな接続先は2個にそろえます。",
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create-auto ingress-fix-gke --region=us-central1 → sim files load kubernetes-ingress → kubectl apply -f ingress-recovery.yaml → kubectl apply -f ingress-broken.json",
      "sim kubernetes request recovery-entry --host=app.example.test --path=/ → kubectl describe ing recovery-entry → kubectl describe svc recovery。IngressはtargetPortではなくService portを参照します。",
      "sim files replace ingress-broken.json --search=8080 --replacement=80 → kubectl apply -f ingress-broken.json",
      "sim files replace ingress-recovery.yaml --search=wrong-recovery --replacement=recovery → kubectl apply -f ingress-recovery.yaml → kubectl get pods → kubectl get endpoints recovery。selector修正だけではreadiness待ちが残ります。",
      "sim kubernetes probe recovery --status-code=200 → kubectl get endpoints recovery → sim kubernetes request recovery-entry --host=app.example.test --path=/。2個のReadyな接続先を確認します。",
    ],
    assertions: [{ kind: "kubeIngressRecovered" }],
  },
];

export const kubeIngressSatisfied = (world: World, recovery: boolean): boolean => {
  const cluster = world.clusters.find(
    (c) =>
      c.projectId === F.devProjectId && c.name === (recovery ? "ingress-fix-gke" : "ingress-gke"),
  );
  if (!cluster) return false;
  const name = recovery ? "recovery-entry" : "app-entry";
  const ingress = KubeIngress.of(world, cluster, "default").find((i) => i.name === name);
  const parsed = KubeManifest.parse(
    world.kubeFiles[recovery ? "ingress-broken.json" : "ingress-routes.json"] ?? "",
  );
  if (!ingress || !Result.isOk(parsed) || parsed.value.length !== 1) return false;
  const manifest = parsed.value[0];
  if (
    manifest?.kind !== "ingress" ||
    manifest.name !== name ||
    (manifest.namespace ?? "default") !== "default"
  )
    return false;
  if (
    JSON.stringify([ingress.labels, ingress.annotations, ingress.paths, ingress.defaultBackend]) !==
    JSON.stringify([manifest.labels, manifest.annotations, manifest.paths, manifest.defaultBackend])
  )
    return false;
  if (Option.isSome(ingress.defaultBackend) || ingress.paths.length !== (recovery ? 1 : 3))
    return false;
  const expected = recovery
    ? [["/", "recovery", "Prefix"]]
    : [
        ["/", "web", "Prefix"],
        ["/api", "api", "Prefix"],
        ["/api/health", "health", "Exact"],
      ];
  if (
    !expected.every(([path, name, type]) =>
      ingress.paths.some(
        (p) =>
          p.host === "app.example.test" &&
          p.path === path &&
          p.pathType === type &&
          p.backend.name === name &&
          p.backend.port === 80,
      ),
    )
  )
    return false;
  for (const name of recovery ? ["recovery"] : ["web", "api", "health"]) {
    const service = world.kubeServices.find(
      (s) =>
        s.projectId === cluster.projectId &&
        s.cluster === cluster.name &&
        s.namespace === "default" &&
        s.name === name,
    );
    const deployment = world.kubeDeployments.find(
      (d) =>
        d.projectId === cluster.projectId &&
        d.cluster === cluster.name &&
        d.namespace === "default" &&
        d.name === name,
    );
    if (
      service?.type !== "NodePort" ||
      service.port !== 80 ||
      service.targetPort !== 8080 ||
      !deployment ||
      deployment.replicas !== 2 ||
      deployment.image !== "nginx:1"
    )
      return false;
    if (recovery && !Option.isSome(deployment.readinessProbe)) return false;
    const backends = KubeServiceRouting.backends(world, service);
    if (backends.length !== 2 || backends.some((b) => b.deployment !== name)) return false;
  }
  const workloads = KubeManifest.parse(
    world.kubeFiles[recovery ? "ingress-recovery.yaml" : "ingress-workloads.yaml"] ?? "",
  );
  if (!Result.isOk(workloads) || workloads.value.length !== (recovery ? 2 : 6)) return false;
  for (const m of workloads.value) {
    if ((m.namespace ?? "default") !== "default") return false;
    if (m.kind === "service") {
      const live = world.kubeServices.find(
        (s) =>
          s.projectId === cluster.projectId &&
          s.cluster === cluster.name &&
          s.namespace === "default" &&
          s.name === m.name,
      );
      if (
        !live ||
        JSON.stringify([live.type, live.selector, live.port, live.targetPort]) !==
          JSON.stringify([m.type, m.selector, m.port, m.targetPort])
      )
        return false;
      continue;
    }
    if (m.kind !== "deployment") return false;
    const live = world.kubeDeployments.find(
      (d) =>
        d.projectId === cluster.projectId &&
        d.cluster === cluster.name &&
        d.namespace === "default" &&
        d.name === m.name,
    );
    if (
      !live ||
      JSON.stringify([live.image, live.replicas, live.podLabels, live.readinessProbe]) !==
        JSON.stringify([m.image, m.replicas, m.podLabels, m.readinessProbe])
    )
      return false;
  }
  const requests = recovery
    ? [["/", "recovery"]]
    : [
        ["/", "web"],
        ["/api/users", "api"],
        ["/api/health", "health"],
        ["/api/health/detail", "api"],
        ["/apix", "web"],
      ];
  return (
    requests.every(([path, name]) => {
      const r = KubeIngress.request(world, ingress, "app.example.test", path ?? "/");
      return Result.isOk(r) && r.value.backend.name === name && r.value.endpoints.length === 2;
    }) && !Option.isSome(KubeIngress.select(ingress, "other.example.test", "/"))
  );
};
