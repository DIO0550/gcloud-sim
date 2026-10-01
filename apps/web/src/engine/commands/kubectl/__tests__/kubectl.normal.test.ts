// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";

const cluster = [
  "gcloud services enable container.googleapis.com",
  "gcloud container clusters create app --zone=asia-northeast1-a --num-nodes=2",
];

test("コンテキストが無いと本物と同じ connection refused になり、ERROR: (gcloud...) の接頭辞は付かない", () => {
  const s = run(session(), "gcloud services enable container.googleapis.com", "kubectl get pods");
  expect(s.text).toContain("The connection to the server localhost:8080 was refused");
  expect(s.text).not.toContain("ERROR: (");
});

test("クラスタを作ると context ができ、get pods は空、create deployment で 1 pod になる", () => {
  const empty = run(session(), ...cluster, "kubectl get pods");
  expect(empty.text).toBe("No resources found in default namespace.");
  const one = run(empty, "kubectl create deployment web --image=nginx", "kubectl get pods");
  expect(one.text).toMatch(
    /^NAME\s+READY\s+STATUS\s+RESTARTS\s+AGE\nweb-[0-9a-z]{10}-[0-9a-z]{5}\s+1\/1\s+Running\s+0\s+0s$/,
  );
});

test("scale --replicas=3 で pod が 3 つになり、減らすと末尾から消える", () => {
  const three = run(
    session(),
    ...cluster,
    "kubectl create deployment web --image=nginx",
    "kubectl scale deployment/web --replicas=3",
    "kubectl get pods",
  );
  expect(three.text.split("\n")).toHaveLength(4);
  const names = three.text
    .split("\n")
    .slice(1)
    .map((l) => l.split(/\s+/)[0]);
  const one = run(three, "kubectl scale deployment web --replicas=1", "kubectl get pods");
  expect(one.text.split("\n")).toHaveLength(2);
  expect(one.text).toContain(names[0] ?? "");
});

test("expose --type=LoadBalancer で get services に EXTERNAL-IP が出る", () => {
  const s = run(
    session(),
    ...cluster,
    "kubectl create deployment web --image=nginx",
    "kubectl expose deployment web --type=LoadBalancer --port=80 --target-port=8080",
    "kubectl get svc",
  );
  expect(s.text).toMatch(
    /web\s+LoadBalancer\s+10\.20\.\d+\.\d+\s+34\.85\.\d+\.\d+\s+80:3\d{4}\/TCP/,
  );
  const clusterIp = run(
    s,
    "kubectl expose deployment web --name=web-internal --port=8080",
    "kubectl get services web-internal",
  );
  expect(clusterIp.text).toMatch(
    /web-internal\s+ClusterIP\s+10\.20\.\d+\.\d+\s+<none>\s+8080\/TCP/,
  );
});

test("apply -f deployment.yaml はサンプルの Deployment を作り、2 回目は unchanged、service.yaml は Service を作る", () => {
  const first = run(session(), ...cluster, "kubectl apply -f deployment.yaml");
  expect(first.text).toBe("deployment.apps/web created");
  const again = run(first, "kubectl apply -f ./deployment.yaml");
  expect(again.text).toBe("deployment.apps/web unchanged");
  const svc = run(again, "kubectl apply -f service.yaml", "kubectl get all");
  expect(svc.text).toContain("service/web");
  expect(svc.text).toContain("deployment.apps/web");
  expect(svc.text.match(/pod\/web-/g)).toHaveLength(2);
});

test("apply -f の無いファイルは本物と同じ does not exist", () => {
  const s = run(session(), ...cluster, "kubectl apply -f nope.yaml");
  expect(s.text).toContain('error: the path "nope.yaml" does not exist');
});

test("delete deployment はリソースを消し、無いものは Error from server (NotFound)", () => {
  const s = run(
    session(),
    ...cluster,
    "kubectl create deployment web --image=nginx",
    "kubectl delete deployment web",
    "kubectl get deployments",
  );
  expect(s.text).toBe("No resources found in default namespace.");
  const missing = run(s, "kubectl delete deployment web");
  expect(missing.text).toBe('Error from server (NotFound): deployments.apps "web" not found');
});

test("delete pod は Deployment が作り直すので pod の名前が変わる", () => {
  const s = run(
    session(),
    ...cluster,
    "kubectl create deployment web --image=nginx",
    "kubectl get pods",
  );
  const before = s.text.split("\n")[1]?.split(/\s+/)[0] ?? "";
  const after = run(s, `kubectl delete pod ${before}`, "kubectl get pods");
  expect(after.text).not.toContain(before);
  expect(after.text.split("\n")).toHaveLength(2);
});

test("rollout status / restart / history と logs は Deployment の世代を使う", () => {
  const s = run(
    session(),
    ...cluster,
    "kubectl create deployment web --image=nginx",
    "kubectl rollout restart deployment/web",
    "kubectl rollout history deployment web",
  );
  expect(s.text).toContain("REVISION  CHANGE-CAUSE");
  expect(s.text.split("\n")).toHaveLength(4);
  const pods = run(s, "kubectl get pods");
  const pod = pods.text.split("\n")[1]?.split(/\s+/)[0] ?? "";
  const logs = run(pods, `kubectl logs ${pod}`);
  expect(logs.text).toContain("[nginx] Listening on port 8080");
  expect(run(pods, "kubectl rollout status deployment/web").text).toBe(
    'deployment "web" successfully rolled out',
  );
});

test("kubectl config は現在のコンテキストと一覧を出し、use-context で切り替わる", () => {
  const s = run(
    session(),
    ...cluster,
    "gcloud container clusters create batch --zone=asia-northeast1-b",
    "kubectl config current-context",
  );
  expect(s.text).toBe("gke_ace-dev-01_asia-northeast1-b_batch");
  const switched = run(
    s,
    "kubectl config use-context gke_ace-dev-01_asia-northeast1-a_app",
    "kubectl config current-context",
  );
  expect(switched.text).toBe("gke_ace-dev-01_asia-northeast1-a_app");
  expect(run(s, "kubectl config get-contexts").text).toContain("*");
});

test("クラスタを消すと Deployment も消える", () => {
  const s = run(
    session(),
    ...cluster,
    "kubectl create deployment web --image=nginx",
    "gcloud container clusters delete app --zone=asia-northeast1-a --quiet",
  );
  expect(s.world.kubeDeployments).toEqual([]);
});

test("Kubernetes の権限が無い主体は E-006 になる", () => {
  const s = run(
    session(),
    ...cluster,
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=roles/container.viewer",
    "kubectl create deployment web --image=nginx --account=dev@example.com",
  );
  expect(s.text).toContain("Required 'container.deployments.create' permission");
});

test("apply に -f が無いと本物と同じ使い方の誤りになる", () => {
  const s = run(session(), ...cluster, "kubectl apply");
  expect(s.text).toBe("error: must specify one of -f and -k");
});

test("create に何も渡さないと -f を求める", () => {
  const s = run(session(), ...cluster, "kubectl create");
  expect(s.text).toBe("error: must specify one of -f and -k");
});

test("delete に何も渡さないと対象を求める", () => {
  const s = run(session(), ...cluster, "kubectl delete");
  expect(s.text).toBe("error: You must provide one or more resources by argument or filename.");
});

test("同名の Deployment を 2 回作ると AlreadyExists", () => {
  const s = run(
    session(),
    ...cluster,
    "kubectl create deployment web --image=nginx",
    "kubectl create deployment web --image=nginx",
  );
  expect(s.text).toBe('Error from server (AlreadyExists): deployments.apps "web" already exists');
});
