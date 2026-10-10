// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { GkeControlPlane } from "@/engine/domains/gke-control-plane";
import { KubeContext } from "@/engine/domains/kube-context";
import { World } from "@/engine/domains/world";
import { Snapshot } from "@/engine/snapshot";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const enabled = () => execute(session(), "gcloud services enable container.googleapis.com");
const create = (name = "private-gke", flags = "") =>
  `gcloud container clusters create ${name} --region=us-central1 --enable-private-nodes --enable-ip-alias --master-ipv4-cidr=172.16.0.0/28 ${flags}`;
const ready = () => execute(enabled(), create());
const execute = (s: Session, ...commands: string[]) =>
  commands.reduce((current, command) => {
    const next = run(current, command);
    expect(next.text, command).not.toMatch(/^(ERROR:|error:)/m);
    expect(World.validate(next.world), command).toEqual(Result.ok(next.world));
    return next;
  }, s);
const rejected = (s: Session, command: string, message: string) => {
  const next = run(s, command);
  expect(next.text, command).toContain(message);
  expect(next.world).toEqual(s.world);
};
const cluster = (s: Session) => {
  const c = s.world.clusters[0];
  if (!c) throw Error("Missing fixture cluster");
  return c;
};
const check = (endpoint: "public" | "private", ip: string, network = "") =>
  `sim gke check-control-plane private-gke --region=us-central1 --endpoint=${endpoint} --source-ip=${ip} ${network ? `--source-network=${network}` : ""}`;
const update = (flags: string) =>
  `gcloud container clusters update private-gke --region=us-central1 ${flags}`;
const restored = (s: Session) =>
  session(
    Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(s.world, Now))))),
  );

test("private nodes retain a public endpoint; endpoint-only update preserves workloads and pools", () => {
  let s = execute(
    ready(),
    "kubectl create deployment web --image=nginx:1",
    check("public", "203.0.113.20"),
  );
  expect(s.text).toContain("ALLOW");
  expect(cluster(s).controlPlane.privateEndpoint).toBe(false);
  const pods = s.world.kubeDeployments;
  const pools = s.world.nodePools;
  s = execute(s, update("--enable-private-endpoint"));
  expect(cluster(s).controlPlane.lastCheck).toEqual(Option.none);
  s = execute(s, check("public", "203.0.113.20"));
  expect(s.text).toContain("endpoint-disabled");
  expect(s.text).toContain("DENY");
  expect(s.world.kubeDeployments).toEqual(pods);
  expect(s.world.nodePools).toEqual(pools);
  expect(execute(s, "gcloud container clusters list").text).toContain("172.16.0.2");
  s = execute(s, update("--no-enable-private-endpoint"), check("public", "203.0.113.20"));
  expect(s.text).toContain("ALLOW");
});

test.each([
  ["--master-ipv4-cidr=172.16.0.0/27", "/28"],
  ["--master-ipv4-cidr=172.16.0.1/28", "/28"],
  ["--master-ipv4-cidr=999.16.0.0/28", "/28"],
  ["--master-ipv4-cidr=::/28", "/28"],
  ["--master-ipv4-cidr=10.128.0.0/28", "overlaps a subnet"],
  ["--network=ghost", "existing network and subnetwork"],
  ["--subnetwork=ghost", "existing network and subnetwork"],
  ["--no-enable-ip-alias", "require --enable-ip-alias"],
  ["--master-authorized-networks=203.0.113.0/24", "requires --enable"],
  [
    "--enable-master-authorized-networks --master-authorized-networks=203.0.113.1/24",
    "canonical IPv4 CIDRs",
  ],
  [
    "--enable-master-authorized-networks --master-authorized-networks=203.0.113.0/24,203.0.113.0/24",
    "Duplicate",
  ],
  ["--enable-authorized-networks-on-private-endpoint", "requires enabled"],
])("invalid private creation %s is atomic", (flags, message) =>
  rejected(enabled(), create("bad", flags), message),
);

test("master CIDR must be unique within a VPC, subnet references must match region and VPC", () => {
  const s = ready();
  rejected(s, create("other"), "overlaps another cluster");
  const custom = execute(
    s,
    "gcloud services enable compute.googleapis.com",
    "gcloud compute networks create custom --subnet-mode=custom",
    "gcloud compute networks subnets create custom-subnet --network=custom --region=us-east1 --range=10.30.0.0/24",
  );
  rejected(
    custom,
    create("other", "--master-ipv4-cidr=172.16.1.0/28 --network=custom --subnetwork=custom-subnet"),
    "existing network and subnetwork",
  );
  rejected(
    custom,
    create("other", "--master-ipv4-cidr=172.16.1.0/28 --subnetwork=custom-subnet"),
    "existing network and subnetwork",
  );
  rejected(
    custom,
    "gcloud compute networks subnets create overlap --network=default --region=us-east1 --range=172.16.0.0/24",
    "overlaps an existing GKE",
  );
});

test("Autopilot and zonal private clusters validate references and preserve node-pool differences", () => {
  const s = execute(
    enabled(),
    "gcloud container clusters create-auto auto --region=us-central1 --enable-private-nodes --master-ipv4-cidr=172.16.1.0/28 --enable-private-endpoint",
    "sim gke check-control-plane auto --region=us-central1 --endpoint=private --source-ip=10.128.0.5 --source-network=default",
  );
  expect(s.text).toContain("ALLOW");
  expect(s.world.nodePools).toEqual([]);
  expect(cluster(s).networkPolicyEnabled).toBe(true);
  const zonal = execute(
    enabled(),
    "gcloud container clusters create zonal --zone=us-central1-a --enable-private-nodes --enable-ip-alias --master-ipv4-cidr=172.16.1.0/28",
    "sim gke check-control-plane zonal --zone=us-central1-a --endpoint=private --source-ip=10.128.0.5 --source-network=default",
  );
  expect(zonal.text).toContain("ALLOW");
});

test.each([
  ["", "Specify a control plane, workload pool or VPA setting"],
  ["--enable-private-nodes", "unrecognized"],
  ["--master-ipv4-cidr=172.16.2.0/28", "unrecognized"],
  ["--master-authorized-networks=203.0.113.0/24", "requires --enable"],
  [
    "--enable-master-authorized-networks --master-authorized-networks=256.0.0.0/8",
    "canonical IPv4",
  ],
  ["--enable-master-authorized-networks --master-authorized-networks=0.0.0.0/33", "canonical IPv4"],
  [
    "--enable-master-authorized-networks --master-authorized-networks=01.2.3.4/32",
    "canonical IPv4",
  ],
  ["--enable-authorized-networks-on-private-endpoint", "requires enabled"],
  ["--enable-master-global-access", "unrecognized"],
])("invalid update %s leaves state unchanged", (flags, message) =>
  rejected(ready(), update(flags), message),
);

test("authorized networks replace rather than merge and explicit disable opens the public endpoint", () => {
  let s = execute(
    ready(),
    update("--enable-master-authorized-networks --master-authorized-networks=203.0.113.0/28"),
    check("public", "203.0.113.20"),
  );
  expect(s.text).toContain("source-not-authorized");
  s = execute(
    s,
    update("--enable-master-authorized-networks --master-authorized-networks=203.0.113.16/28"),
  );
  expect(cluster(s).controlPlane.lastCheck).toEqual(Option.none);
  expect(cluster(s).controlPlane.authorizedNetworks).toEqual(Option.some(["203.0.113.16/28"]));
  s = execute(s, check("public", "203.0.113.20"));
  expect(s.text).toContain("authorized-cidr");
  expect(execute(s, check("public", "203.0.113.0")).text).toContain("DENY");
  expect(execute(s, check("public", "203.0.113.31")).text).toContain("ALLOW");
  expect(execute(s, check("public", "203.0.113.32")).text).toContain("DENY");
  s = execute(s, update("--no-enable-master-authorized-networks"), check("public", "203.0.113.32"));
  expect(s.text).toContain("ALLOW");
});

test("private route needs declared same VPC and regional subnet address; CIDR alone cannot create a route", () => {
  let s = execute(
    ready(),
    update("--enable-master-authorized-networks --master-authorized-networks=203.0.113.0/24"),
  );
  expect(execute(s, check("private", "10.128.0.5")).text).toContain("no-same-region-vpc-route");
  expect(execute(s, check("private", "10.142.0.5", "default")).text).toContain(
    "no-same-region-vpc-route",
  );
  expect(execute(s, check("private", "203.0.113.20", "default")).text).toContain(
    "no-same-region-vpc-route",
  );
  s = execute(s, check("private", "10.128.0.5", "default"));
  expect(s.text).toContain("same-region-vpc");
  s = execute(
    s,
    update("--enable-authorized-networks-on-private-endpoint"),
    check("private", "10.128.0.5", "default"),
  );
  expect(s.text).toContain("DENY");
  s = execute(
    s,
    update("--enable-master-authorized-networks --master-authorized-networks=10.128.0.5/32"),
    check("private", "10.128.0.5", "default"),
  );
  expect(s.text).toContain("ALLOW");
  expect(execute(s, check("private", "10.128.0.6", "default")).text).toContain("DENY");
  rejected(s, update("--no-enable-master-authorized-networks"), "requires enabled");
  s = execute(
    s,
    update(
      "--no-enable-authorized-networks-on-private-endpoint --no-enable-master-authorized-networks",
    ),
    check("private", "10.128.0.6", "default"),
  );
  expect(s.text).toContain("ALLOW");
});

test("public-only clusters reject ignored private-network flags; CIDR /0 and /32 boundaries work", () => {
  const s = execute(
    enabled(),
    "gcloud container clusters create public --region=us-central1 --enable-master-authorized-networks --master-authorized-networks=255.255.255.255/32",
  );
  rejected(
    s,
    "gcloud container clusters get-credentials public --region=us-central1 --internal-ip",
    "unavailable",
  );
  rejected(
    s,
    "gcloud container clusters update public --region=us-central1 --enable-private-endpoint",
    "requires a private cluster",
  );
  rejected(
    s,
    "gcloud container clusters create bad --region=us-central1 --network=default",
    "require --enable-private-nodes",
  );
  expect(
    execute(
      s,
      "sim gke check-control-plane public --region=us-central1 --endpoint=public --source-ip=255.255.255.255",
    ).text,
  ).toContain("ALLOW");
  const open = execute(
    s,
    "gcloud container clusters update public --region=us-central1 --enable-master-authorized-networks --master-authorized-networks=0.0.0.0/0",
    "sim gke check-control-plane public --region=us-central1 --endpoint=public --source-ip=255.255.255.255",
  );
  expect(open.text).toContain("ALLOW");
  const empty = execute(
    open,
    "gcloud container clusters update public --region=us-central1 --no-enable-master-authorized-networks",
    "gcloud container clusters update public --region=us-central1 --enable-master-authorized-networks",
    "sim gke check-control-plane public --region=us-central1 --endpoint=public --source-ip=0.0.0.0",
  );
  expect(empty.text).toContain("DENY");
});

test("credentials persist target independently from check and namespace, cannot use unavailable endpoint", () => {
  let s = execute(
    ready(),
    "kubectl config set-context --current --namespace=demo",
    "gcloud container clusters get-credentials private-gke --region=us-central1 --internal-ip",
  );
  expect(s.text).toContain("https://172.16.0.2");
  expect(s.text).toContain("到達を保証しません");
  expect(KubeContext.namespace(s.world, cluster(s))).toBe("demo");
  s = restored(s);
  expect(execute(s, "kubectl config view").text).toContain("https://172.16.0.2");
  expect(cluster(s).controlPlane.lastCheck).toEqual(Option.none);
  s = execute(
    s,
    "gcloud container clusters get-credentials private-gke --region=us-central1 --no-internal-ip",
    update("--enable-private-endpoint"),
  );
  expect(KubeContext.endpoint(s.world, cluster(s))).toBe("public");
  expect(execute(s, "kubectl config view").text).toContain("https://unavailable");
  rejected(
    s,
    "gcloud container clusters get-credentials private-gke --region=us-central1 --no-internal-ip",
    "unavailable",
  );
  s = execute(
    s,
    "gcloud container clusters get-credentials private-gke --region=us-central1",
    check("private", "10.128.0.5", "default"),
  );
  expect(restored(s).world).toEqual(s.world);
  const deleted = execute(
    s,
    "gcloud container clusters delete private-gke --region=us-central1 --quiet",
  );
  expect(deleted.world.kubeContextEndpoints).toEqual({});
  expect(deleted.world.kubeContextNamespaces).toEqual({});
});

test("API, permission, project, location and source errors do not mutate the diagnostic", () => {
  const s = execute(ready(), check("private", "10.128.0.5", "default"));
  rejected(s, check("private", "999.1.2.3", "default"), "canonical IPv4");
  rejected(s, check("private", "10.128.0.5", "ghost"), "not found");
  rejected(
    s,
    "sim gke check-control-plane private-gke --region=us-east1 --endpoint=public --source-ip=203.0.113.20",
    "Not found",
  );
  rejected(
    s,
    `${update("--enable-private-endpoint")} --zone=us-central1-a`,
    "either --zone or --region",
  );
  rejected(
    s,
    `${update("--enable-private-endpoint")} --project=ace-prod-01`,
    "container.googleapis.com",
  );
  const viewer = execute(
    s,
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:developer@example.com --role=roles/container.viewer",
    "gcloud auth login developer@example.com",
  );
  rejected(viewer, update("--enable-private-endpoint"), "container.clusters.update");
  expect(execute(viewer, check("private", "10.128.0.5", "default")).text).toContain("ALLOW");
  const off = execute(s, "gcloud services disable container.googleapis.com --quiet");
  rejected(off, check("public", "203.0.113.20"), "container.googleapis.com");
});

test("subnet additions clear old route evaluations and unrelated master/pool upgrades retain them", () => {
  let s = execute(ready(), check("private", "10.130.0.5", "default"));
  expect(s.text).toContain("DENY");
  s = execute(
    s,
    "gcloud services enable compute.googleapis.com",
    "gcloud compute networks subnets create new --region=us-central1 --network=default --range=10.130.0.0/24",
  );
  expect(cluster(s).controlPlane.lastCheck).toEqual(Option.none);
  s = execute(s, check("private", "10.130.0.5", "default"));
  expect(s.text).toContain("ALLOW");
  const recorded = cluster(s).controlPlane.lastCheck;
  s = execute(
    s,
    "gcloud container clusters upgrade private-gke --region=us-central1 --master --quiet",
  );
  expect(cluster(s).controlPlane.lastCheck).toEqual(recorded);
});

test("v27 restores all pool management/evaluation/deleted default and Kubernetes persistent data", () => {
  const s = execute(
    enabled(),
    "gcloud container clusters create old --region=us-central1 --num-nodes=2",
    "gcloud container node-pools create apps --cluster=old --region=us-central1 --num-nodes=0 --no-enable-autoupgrade",
    "gcloud container node-pools update apps --cluster=old --region=us-central1 --enable-autoscaling --min-nodes=0 --max-nodes=4",
    "sim gke autoscale-nodes apps --cluster=old --region=us-central1 --required-nodes=10",
    "gcloud container node-pools delete default-pool --cluster=old --region=us-central1 --quiet",
    "sim files load kubernetes-storage",
    "kubectl apply -f archive-class.yaml",
    "kubectl apply -f storage-claim.yaml",
    "kubectl apply -f storage-web.yaml",
    "sim kubernetes write-file storage-web --path=/data/saved.txt --content=retained",
    "sim files load kubernetes-ingress",
    "kubectl apply -f ingress-workloads.yaml",
    "kubectl apply -f ingress-routes.json",
    "sim files load kubernetes-network-policy",
    "kubectl apply -f deny-ingress.json",
  );
  const old = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
  old.schemaVersion = 27;
  delete old.world.kubeContextEndpoints;
  for (const c of old.world.clusters) delete c.controlPlane;
  const next = Result.unwrap(Snapshot.fromUnknown(old));
  expect(next.nodePools).toEqual(s.world.nodePools);
  expect(next.nodePools.some((p) => p.name === "default-pool")).toBe(false);
  expect(next.kubePvs).toEqual(s.world.kubePvs);
  expect(next.kubeDeployments).toEqual(s.world.kubeDeployments);
  expect(next.kubeIngresses).toEqual(s.world.kubeIngresses);
  expect(next.kubeNetworkPolicies).toEqual(s.world.kubeNetworkPolicies);
  expect(next.clusters[0]?.controlPlane).toEqual(GkeControlPlane.public());
  expect(next.kubeContextEndpoints).toEqual({});
  expect(Snapshot.create(next, Now).schemaVersion).toBe(38);
});

test.each(["cidr", "network", "overlap", "enforcement", "stale", "source", "context", "subnet"])(
  "invalid saved %s is rejected",
  (kind) => {
    const s = execute(ready(), check("private", "10.128.0.5", "default"));
    const json = JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
    const cp = json.world.clusters[0].controlPlane;
    if (kind === "cidr") cp.privateNetwork.value.masterIpv4Cidr = "172.16.0.1/28";
    if (kind === "network") cp.privateNetwork.value.network = "ghost";
    if (kind === "overlap") cp.privateNetwork.value.masterIpv4Cidr = "10.128.0.0/28";
    if (kind === "enforcement") cp.enforcePrivateEndpoint = true;
    if (kind === "stale") cp.lastCheck.value.allowed = false;
    if (kind === "source") cp.lastCheck.value.sourceIp = "999.0.0.0";
    if (kind === "context") json.world.kubeContextEndpoints.ghost = "private";
    if (kind === "subnet")
      json.world.subnets.find((s: { region: string }) => s.region === "us-central1").ipCidrRange =
        "999.0.0.0/8";
    expect(Result.isOk(Snapshot.fromUnknown(json))).toBe(false);
  },
);

test("private mission needs restricted internal endpoint, explicit credentials and exact successful source evaluation", () => {
  let s = execute(
    session(Result.unwrap(Engine.startMission(session().world, "m-gke-030"))),
    "gcloud services enable container.googleapis.com",
    create(),
    update(
      "--enable-private-endpoint --enable-master-authorized-networks --master-authorized-networks=10.128.0.5/32 --enable-authorized-networks-on-private-endpoint",
    ),
  );
  const status = () => s.world.missions.find((m) => m.id === "m-gke-030")?.status;
  expect(status()).not.toBe("completed");
  // Creation's public credentials remain stale until explicitly refreshed.
  s = execute(s, check("private", "10.128.0.5", "default"));
  expect(status()).not.toBe("completed");
  s = execute(
    s,
    check("private", "10.128.0.6", "default"),
    "gcloud container clusters get-credentials private-gke --region=us-central1 --internal-ip",
  );
  expect(status()).not.toBe("completed");
  s = execute(s, check("public", "10.128.0.5", "default"));
  expect(status()).not.toBe("completed");
  s = execute(s, check("private", "10.128.0.5", "default"));
  expect(status()).toBe("completed");
});

test("public CIDR mission rejects wrong/wide settings and settings-only, requires correct explicit check", () => {
  let s = execute(
    session(Result.unwrap(Engine.startMission(session().world, "m-gke-031"))),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create authorized-gke --region=us-central1 --enable-private-nodes --enable-ip-alias --master-ipv4-cidr=172.16.1.0/28 --enable-master-authorized-networks --master-authorized-networks=203.0.113.0/28",
  );
  const status = () => s.world.missions.find((m) => m.id === "m-gke-031")?.status;
  const evalPublic =
    "sim gke check-control-plane authorized-gke --region=us-central1 --endpoint=public --source-ip=203.0.113.20";
  const settings =
    "gcloud container clusters update authorized-gke --region=us-central1 --enable-master-authorized-networks";
  s = execute(s, evalPublic);
  expect(status()).not.toBe("completed");
  s = execute(s, `${settings} --master-authorized-networks=0.0.0.0/0`, evalPublic);
  expect(status()).not.toBe("completed");
  s = execute(s, `${settings} --master-authorized-networks=203.0.113.16/28`);
  expect(status()).not.toBe("completed");
  s = execute(
    s,
    "sim gke check-control-plane authorized-gke --region=us-central1 --endpoint=private --source-ip=10.128.0.5 --source-network=default",
  );
  expect(status()).not.toBe("completed");
  s = execute(s, evalPublic);
  expect(status()).toBe("completed");
});

test("help and completion advertise the implemented settings, endpoints and project-scoped resources", () => {
  const s = ready();
  expect(run(s, "gcloud container clusters update --help").text).toContain(
    "--enable-authorized-networks-on-private-endpoint",
  );
  expect(run(s, "sim gke check-control-plane --help").text).toContain("--source-network");
  expect(Engine.completionCandidates(s.world, "gcloud container clusters update priv")).toContain(
    "private-gke",
  );
  expect(
    Engine.completionCandidates(s.world, "gcloud container clusters create new --network=d"),
  ).toContain("--network=default");
  expect(
    Engine.completionCandidates(s.world, "sim gke check-control-plane private-gke --endpoint=p"),
  ).toEqual(expect.arrayContaining(["--endpoint=public", "--endpoint=private"]));
});

test.each([false, true])(
  "authorized CIDR limit differs for private=%s and survives import",
  (privateCluster) => {
    const ranges = Array.from(
      { length: privateCluster ? 100 : 50 },
      (_, n) => `203.0.113.${n}/32`,
    ).join(",");
    const name = privateCluster ? "private-gke" : "public-gke";
    const s = execute(
      enabled(),
      privateCluster
        ? create()
        : "gcloud container clusters create public-gke --region=us-central1",
      `gcloud container clusters update ${name} --region=us-central1 --enable-master-authorized-networks --master-authorized-networks=${ranges}`,
    );
    expect(restored(s).world).toEqual(s.world);
    rejected(
      s,
      `gcloud container clusters update ${name} --region=us-central1 --enable-master-authorized-networks --master-authorized-networks=${ranges},203.0.114.0/32`,
      "CIDR count limit",
    );
  },
);

test("custom VPC/subnet references work and the same master range in another VPC is independent", () => {
  const s = execute(
    ready(),
    "gcloud services enable compute.googleapis.com",
    "gcloud compute networks create custom --subnet-mode=custom",
    "gcloud compute networks subnets create custom-subnet --region=us-central1 --network=custom --range=10.30.0.0/24",
    create("custom-gke", "--network=custom --subnetwork=custom-subnet"),
    "sim gke check-control-plane custom-gke --region=us-central1 --endpoint=private --source-ip=10.30.0.5 --source-network=custom",
  );
  expect(s.text).toContain("ALLOW");
  expect(
    execute(
      s,
      "sim gke check-control-plane custom-gke --region=us-central1 --endpoint=private --source-ip=10.30.0.5 --source-network=default",
    ).text,
  ).toContain("no-same-region-vpc-route");
});

test("deleting a source-only VPC clears the stored check and does not leave invalid snapshot references", () => {
  let s = execute(
    ready(),
    "gcloud services enable compute.googleapis.com",
    "gcloud compute networks create source --subnet-mode=custom",
    check("public", "203.0.113.20", "source"),
  );
  expect(cluster(s).controlPlane.lastCheck).toEqual(
    Option.some({
      endpoint: "public",
      sourceIp: "203.0.113.20",
      sourceNetwork: "source",
      allowed: true,
      reason: "public-endpoint",
    }),
  );
  s = execute(s, "gcloud compute networks delete source --quiet");
  expect(cluster(s).controlPlane.lastCheck).toEqual(Option.none);
  expect(restored(s).world).toEqual(s.world);
  rejected(s, check("public", "203.0.113.20", "source"), "not found");
});

test("private endpoint CIDR enforcement leaves the public endpoint VPC exception independent", () => {
  const s = execute(
    ready(),
    update(
      "--enable-master-authorized-networks --master-authorized-networks=10.128.0.5/32 --enable-authorized-networks-on-private-endpoint",
    ),
  );
  expect(execute(s, check("private", "10.128.0.6", "default")).text).toContain("DENY");
  expect(execute(s, check("public", "10.128.0.6", "default")).text).toContain("ALLOW");
  expect(execute(s, check("public", "203.0.113.20")).text).toContain("DENY");
});
