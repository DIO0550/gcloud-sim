import {
  DefaultMachineType,
  type MachineTypeName,
  type Region,
  Zone,
} from "@/engine/domains/catalog";
import { ResourceName } from "@/engine/domains/compute";
import { Ipv4 } from "@/engine/domains/gke-control-plane";
import type { CloudRunService, GkeCluster, NodePool } from "@/engine/domains/managed-services";
import type { RuntimeConfig } from "@/engine/domains/serverless-lab/model";
import type { CommandStep } from "@/features/simulator/features/console/domains/edit-command/storage";
import {
  collect,
  type FieldErrors,
  flag,
  integerOf,
  quote,
} from "@/features/simulator/features/console/domains/equivalent-command";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { StringEx } from "@/utils/StringEx";

const NoChangesComment = "# 変更された項目がありません";

const sameStringList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const intRangeError = (raw: string, min: number, max: number): Option<string> => {
  const parsed = integerOf(raw.trim());
  return Option.isSome(parsed) && parsed.value >= min && parsed.value <= max
    ? Option.none
    : Option.some(`${min}〜${max} の整数で指定してください`);
};

// --- GKE クラスタ ---

/** GKE クラスタ編集フォームの値。名前・ロケーション・モードは作成後に変更不可。 */
export type ClusterEditForm = Readonly<{
  name: string;
  location: Zone | Region;
  autopilot: boolean;
  /** Standard クラスタの対象ノードプール名（Autopilot またはプール無しなら空） */
  poolName: string;
  numNodes: string;
  enableAutoscaling: boolean;
  minNodes: string;
  maxNodes: string;
  autoRepair: boolean;
  autoUpgrade: boolean;
  enableWorkloadIdentity: boolean;
  enableVpa: boolean;
  enableAuthorizedNetworks: boolean;
  authorizedNetworks: string;
  original: Readonly<{
    numNodes: number;
    enableAutoscaling: boolean;
    minNodes: number;
    maxNodes: number;
    autoRepair: boolean;
    autoUpgrade: boolean;
    enableWorkloadIdentity: boolean;
    enableVpa: boolean;
    enableAuthorizedNetworks: boolean;
    authorizedNetworks: readonly string[];
  }>;
}>;

export const ClusterEditForm = {
  /** 既存のクラスタとノードプールから編集フォームの初期値を作る。 */
  fromCluster(cluster: GkeCluster, pool: Option<NodePool>): ClusterEditForm {
    const authNetworks = Option.unwrapOr(cluster.controlPlane.authorizedNetworks, []);
    const enableAuthorizedNetworks = Option.isSome(cluster.controlPlane.authorizedNetworks);
    const hasPool = !cluster.autopilot && Option.isSome(pool);
    const p = Option.isSome(pool) ? pool.value : undefined;
    const autoscaling =
      p !== undefined && Option.isSome(p.autoscaling) ? p.autoscaling.value : undefined;
    const numNodes = p?.nodeCount ?? cluster.nodeCount;
    const minNodes = autoscaling?.minNodes ?? 1;
    const maxNodes = autoscaling?.maxNodes ?? Math.max(numNodes, 3);
    const enableAutoscaling = autoscaling !== undefined;
    const autoRepair = p?.autoRepair ?? true;
    const autoUpgrade = p?.autoUpgrade ?? true;
    const enableWorkloadIdentity = cluster.autopilot || (cluster.workloadPool ?? "") !== "";
    const enableVpa = cluster.autopilot || cluster.verticalPodAutoscaling === true;

    return {
      name: cluster.name,
      location: cluster.location,
      autopilot: cluster.autopilot,
      poolName: hasPool && p !== undefined ? p.name : "",
      numNodes: String(numNodes),
      enableAutoscaling,
      minNodes: String(minNodes),
      maxNodes: String(maxNodes),
      autoRepair,
      autoUpgrade,
      enableWorkloadIdentity,
      enableVpa,
      enableAuthorizedNetworks,
      authorizedNetworks: authNetworks.join(", "),
      original: {
        numNodes,
        enableAutoscaling,
        minNodes,
        maxNodes,
        autoRepair,
        autoUpgrade,
        enableWorkloadIdentity,
        enableVpa,
        enableAuthorizedNetworks,
        authorizedNetworks: authNetworks,
      },
    };
  },

  /** 既定の空フォーム（`useCreateForm` の初期ファクトリ用）。 */
  empty(): ClusterEditForm {
    return {
      name: "",
      location: "asia-northeast1-a",
      autopilot: false,
      poolName: "",
      numNodes: "3",
      enableAutoscaling: false,
      minNodes: "1",
      maxNodes: "3",
      autoRepair: true,
      autoUpgrade: true,
      enableWorkloadIdentity: false,
      enableVpa: false,
      enableAuthorizedNetworks: false,
      authorizedNetworks: "",
      original: {
        numNodes: 3,
        enableAutoscaling: false,
        minNodes: 1,
        maxNodes: 3,
        autoRepair: true,
        autoUpgrade: true,
        enableWorkloadIdentity: false,
        enableVpa: false,
        enableAuthorizedNetworks: false,
        authorizedNetworks: [],
      },
    };
  },

  /** ノード数・オートスケーリング範囲・承認済みネットワーク CIDR を検証する。 */
  collectErrors(form: ClusterEditForm): FieldErrors<ClusterEditForm> {
    const cidrs = StringEx.splitList(form.authorizedNetworks);
    const authError: Option<string> = (() => {
      if (!form.enableAuthorizedNetworks) return Option.none;
      const bad = cidrs.find((c) => !Option.isSome(Ipv4.range(c)));
      if (bad !== undefined) {
        return Option.some(`正規の IPv4 CIDR 形式で指定してください: ${bad}`);
      }
      if (new Set(cidrs).size !== cidrs.length) {
        return Option.some("重複した CIDR があります");
      }
      return Option.none;
    })();

    const hasPool = !form.autopilot && form.poolName !== "";
    const min = integerOf(form.minNodes.trim());
    const max = integerOf(form.maxNodes.trim());
    const minError =
      hasPool && form.enableAutoscaling ? intRangeError(form.minNodes, 0, 1000) : Option.none;
    const maxError: Option<string> = (() => {
      if (!hasPool || !form.enableAutoscaling) return Option.none;
      const rangeErr = intRangeError(form.maxNodes, 1, 1000);
      if (Option.isSome(rangeErr)) return rangeErr;
      if (Option.isSome(min) && Option.isSome(max) && max.value < min.value) {
        return Option.some("最大ノード数は最小ノード数以上にしてください");
      }
      return Option.none;
    })();
    const numNodesError =
      hasPool && !form.enableAutoscaling ? intRangeError(form.numNodes, 0, 1000) : Option.none;

    return collect<ClusterEditForm>([
      ["numNodes", numNodesError],
      ["minNodes", minError],
      ["maxNodes", maxError],
      ["authorizedNetworks", authError],
    ]);
  },

  /** 変更された項目だけを実行可能なコマンド列（クラスタ更新 → オートスケーリング → リサイズ → 管理設定）にする。 */
  toSteps(form: ClusterEditForm, projectId: string): readonly CommandStep[] {
    const scopeFlag = Option.isSome(Zone.parse(form.location))
      ? flag("zone", form.location)
      : flag("region", form.location);
    const steps: CommandStep[] = [];

    // 1. クラスタ本体の更新（承認済みネットワーク・Workload Identity・VPA）
    const clusterFlags: string[] = [];
    const cidrs = StringEx.splitList(form.authorizedNetworks);
    const authChanged =
      form.enableAuthorizedNetworks !== form.original.enableAuthorizedNetworks ||
      (form.enableAuthorizedNetworks && !sameStringList(cidrs, form.original.authorizedNetworks));
    if (authChanged) {
      if (form.enableAuthorizedNetworks) {
        clusterFlags.push("--enable-master-authorized-networks");
        if (cidrs.length > 0) {
          clusterFlags.push(flag("master-authorized-networks", cidrs.join(",")));
        } else if (form.original.authorizedNetworks.length > 0) {
          clusterFlags.push('--master-authorized-networks=""');
        }
      } else {
        clusterFlags.push("--no-enable-master-authorized-networks");
      }
    }
    if (!form.autopilot) {
      if (form.enableWorkloadIdentity !== form.original.enableWorkloadIdentity) {
        clusterFlags.push(
          form.enableWorkloadIdentity
            ? flag("workload-pool", `${projectId}.svc.id.goog`)
            : '--workload-pool=""',
        );
      }
      if (form.enableVpa !== form.original.enableVpa) {
        clusterFlags.push(
          form.enableVpa
            ? "--enable-vertical-pod-autoscaling"
            : "--no-enable-vertical-pod-autoscaling",
        );
      }
    }
    if (clusterFlags.length > 0) {
      steps.push({
        line: [
          "gcloud container clusters update",
          quote(form.name),
          scopeFlag,
          flag("project", projectId),
          ...clusterFlags,
        ].join(" "),
        note: `クラスタ設定を更新 (${form.name})`,
      });
    }

    if (!form.autopilot && form.poolName !== "") {
      // 2. ノードプールのオートスケーリング（手動リサイズより先に無効化する必要がある）
      const min = integerOf(form.minNodes.trim());
      const max = integerOf(form.maxNodes.trim());
      const autoscalingChanged =
        form.enableAutoscaling !== form.original.enableAutoscaling ||
        (form.enableAutoscaling &&
          (!Option.isSome(min) ||
            min.value !== form.original.minNodes ||
            !Option.isSome(max) ||
            max.value !== form.original.maxNodes));
      if (autoscalingChanged) {
        const scalingFlags = form.enableAutoscaling
          ? [
              "--enable-autoscaling",
              flag("min-nodes", form.minNodes.trim()),
              flag("max-nodes", form.maxNodes.trim()),
            ]
          : ["--no-enable-autoscaling"];
        steps.push({
          line: [
            "gcloud container node-pools update",
            quote(form.poolName),
            flag("cluster", form.name),
            scopeFlag,
            flag("project", projectId),
            ...scalingFlags,
          ].join(" "),
          note: `ノードプールのオートスケーリングを更新 (${form.poolName})`,
        });
      }

      // 3. 手動ノード数のリサイズ（オートスケーリング無効時のみ）
      if (!form.enableAutoscaling) {
        const nextNodes = integerOf(form.numNodes.trim());
        if (!Option.isSome(nextNodes) || nextNodes.value !== form.original.numNodes) {
          steps.push({
            line: [
              "gcloud container clusters resize",
              quote(form.name),
              scopeFlag,
              flag("project", projectId),
              flag("node-pool", form.poolName),
              flag("num-nodes", form.numNodes.trim()),
              "--quiet",
            ].join(" "),
            note: `クラスタのノード数を変更 (${form.name})`,
          });
        }
      }

      // 4. ノードプールの管理設定（エンジン仕様上オートスケーリングとは別コマンド）
      const mgmtFlags: string[] = [];
      if (form.autoRepair !== form.original.autoRepair) {
        mgmtFlags.push(form.autoRepair ? "--enable-autorepair" : "--no-enable-autorepair");
      }
      if (form.autoUpgrade !== form.original.autoUpgrade) {
        mgmtFlags.push(form.autoUpgrade ? "--enable-autoupgrade" : "--no-enable-autoupgrade");
      }
      if (mgmtFlags.length > 0) {
        steps.push({
          line: [
            "gcloud container node-pools update",
            quote(form.poolName),
            flag("cluster", form.name),
            scopeFlag,
            flag("project", projectId),
            ...mgmtFlags,
          ].join(" "),
          note: `ノードプールの管理設定を更新 (${form.poolName})`,
        });
      }
    }

    return steps;
  },

  /** 同等のコマンドライン表示用。複数コマンドは改行で並べる。 */
  toCommand(form: ClusterEditForm, projectId: string): string {
    const steps = ClusterEditForm.toSteps(form, projectId);
    return steps.length === 0 ? NoChangesComment : steps.map((s) => s.line).join("\n");
  },
} as const;

// --- GKE ノードプール ---

/** GKE Standard クラスタのノードプール作成フォームの値。 */
export type NodePoolCreateForm = Readonly<{
  clusterName: string;
  location: Zone | Region;
  name: string;
  machineType: MachineTypeName;
  numNodes: string;
  enableAutoscaling: boolean;
  minNodes: string;
  maxNodes: string;
}>;

const clusterScopeFlag = (location: Zone | Region): string =>
  Option.isSome(Zone.parse(location)) ? flag("zone", location) : flag("region", location);

export const NodePoolCreateForm = {
  create(cluster: Pick<GkeCluster, "name" | "location">): NodePoolCreateForm {
    return {
      clusterName: cluster.name,
      location: cluster.location,
      name: "",
      machineType: DefaultMachineType,
      numNodes: "3",
      enableAutoscaling: false,
      minNodes: "1",
      maxNodes: "3",
    };
  },

  empty(): NodePoolCreateForm {
    return NodePoolCreateForm.create({ name: "", location: "asia-northeast1-a" });
  },

  collectErrors(form: NodePoolCreateForm): FieldErrors<NodePoolCreateForm> {
    const parsedName = ResourceName.parse(form.name.trim());
    const nameError = Result.isOk(parsedName) ? Option.none : Option.some(parsedName.error);
    const numNodesError = intRangeError(form.numNodes, 0, 1000);
    const min = integerOf(form.minNodes.trim());
    const max = integerOf(form.maxNodes.trim());
    const minError = form.enableAutoscaling ? intRangeError(form.minNodes, 0, 1000) : Option.none;
    const maxError: Option<string> = (() => {
      if (!form.enableAutoscaling) return Option.none;
      const rangeErr = intRangeError(form.maxNodes, 1, 1000);
      if (Option.isSome(rangeErr)) return rangeErr;
      if (Option.isSome(min) && Option.isSome(max) && max.value < min.value) {
        return Option.some("最大ノード数は最小ノード数以上にしてください");
      }
      return Option.none;
    })();
    return collect<NodePoolCreateForm>([
      ["name", nameError],
      ["numNodes", numNodesError],
      ["minNodes", minError],
      ["maxNodes", maxError],
    ]);
  },

  toCommand(form: NodePoolCreateForm, projectId: string): string {
    const parts = [
      "gcloud container node-pools create",
      quote(form.name.trim()),
      flag("cluster", form.clusterName),
      clusterScopeFlag(form.location),
      flag("project", projectId),
      flag("machine-type", form.machineType),
      flag("num-nodes", form.numNodes.trim()),
    ];
    if (form.enableAutoscaling) {
      parts.push(
        "--enable-autoscaling",
        flag("min-nodes", form.minNodes.trim()),
        flag("max-nodes", form.maxNodes.trim()),
      );
    }
    return parts.join(" ");
  },

  deleteCommand(
    cluster: Pick<GkeCluster, "name" | "location">,
    poolName: string,
    projectId: string,
  ): string {
    return [
      "gcloud container node-pools delete",
      quote(poolName),
      flag("cluster", cluster.name),
      clusterScopeFlag(cluster.location),
      flag("project", projectId),
      "--quiet",
    ].join(" ");
  },
} as const;

// --- Cloud Run サービス ---

export type RunServiceCpu = "1" | "2" | "4" | "6" | "8";
export type RunServiceIngress = RuntimeConfig["ingress"];

export const RunServiceCpuChoices: readonly RunServiceCpu[] = ["1", "2", "4", "6", "8"];

const ForbiddenEnvKeys = new Set(["__proto__", "constructor", "prototype", "PORT"]);

const formatMemory = (mb: number): string =>
  mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024}Gi` : `${mb}Mi`;

const parseMemoryMb = (raw: string): Option<number> => {
  const match = /^(\d+)(Mi|Gi|MB|GB|M|G)?$/i.exec(raw.trim());
  if (match === null) return Option.none;
  const amount = Number(match[1]);
  const mb = /g/i.test(match[2] ?? "") ? amount * 1024 : amount;
  return Number.isSafeInteger(mb) && mb >= 128 && mb <= 32768 ? Option.some(mb) : Option.none;
};

const formatEnvVars = (env: Readonly<Record<string, string>>): string =>
  Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

const parseEnvVars = (raw: string): Result<Readonly<Record<string, string>>, string> => {
  const trimmed = raw.trim();
  if (trimmed === "") return Result.ok({});
  const pairs = trimmed.split(",");
  const entries: [string, string][] = [];
  for (const part of pairs) {
    const item = part.trim();
    if (item === "") continue;
    const eq = item.indexOf("=");
    if (eq <= 0) {
      return Result.err(`KEY=VALUE の形式で指定してください: ${item}`);
    }
    const key = item.slice(0, eq).trim();
    const value = item.slice(eq + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || ForbiddenEnvKeys.has(key)) {
      return Result.err(`環境変数名が不正です（PORT や予約語は不可）: ${key}`);
    }
    if (value.length > 4096) {
      return Result.err(`環境変数 ${key} の値が長すぎます（4096 文字以内）`);
    }
    entries.push([key, value]);
  }
  if (entries.length > 100) {
    return Result.err("環境変数は 100 個以内で指定してください");
  }
  return Result.ok(Object.fromEntries(entries));
};

const sameRecord = (
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean => {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  return keysA.length === keysB.length && keysA.every((k) => a[k] === b[k]);
};

/** Cloud Run サービス編集フォームの値。サービス名・リージョンは作成後に変更不可。 */
export type RunServiceEditForm = Readonly<{
  name: string;
  region: Region;
  image: string;
  cpu: RunServiceCpu;
  memory: string;
  minInstances: string;
  maxInstances: string;
  concurrency: string;
  timeout: string;
  ingress: RunServiceIngress;
  envVars: string;
  allowUnauthenticated: boolean;
  original: Readonly<{
    image: string;
    cpu: number;
    memoryMb: number;
    minInstances: number;
    maxInstances: number;
    concurrency: number;
    timeoutSeconds: number;
    ingress: RunServiceIngress;
    env: Readonly<Record<string, string>>;
    allowUnauthenticated: boolean;
  }>;
}>;

export const RunServiceEditForm = {
  /** 既存の Cloud Run サービスと最新リビジョン設定から編集フォームの初期値を作る。 */
  fromService(service: CloudRunService, config: RuntimeConfig): RunServiceEditForm {
    const cpuStr = (
      RunServiceCpuChoices.includes(String(config.cpu) as RunServiceCpu) ? String(config.cpu) : "1"
    ) as RunServiceCpu;
    return {
      name: service.name,
      region: service.region,
      image: service.image,
      cpu: cpuStr,
      memory: formatMemory(config.memoryMb),
      minInstances: String(config.minInstances),
      maxInstances: String(config.maxInstances),
      concurrency: String(config.concurrency),
      timeout: String(config.timeoutSeconds),
      ingress: config.ingress,
      envVars: formatEnvVars(config.env),
      allowUnauthenticated: service.allowUnauthenticated,
      original: {
        image: service.image,
        cpu: config.cpu,
        memoryMb: config.memoryMb,
        minInstances: config.minInstances,
        maxInstances: config.maxInstances,
        concurrency: config.concurrency,
        timeoutSeconds: config.timeoutSeconds,
        ingress: config.ingress,
        env: config.env,
        allowUnauthenticated: service.allowUnauthenticated,
      },
    };
  },

  /** 既定の空フォーム（`useCreateForm` の初期ファクトリ用）。 */
  empty(region: Region = "asia-northeast1"): RunServiceEditForm {
    return {
      name: "",
      region,
      image: "",
      cpu: "1",
      memory: "256Mi",
      minInstances: "0",
      maxInstances: "100",
      concurrency: "80",
      timeout: "300",
      ingress: "all",
      envVars: "",
      allowUnauthenticated: false,
      original: {
        image: "",
        cpu: 1,
        memoryMb: 256,
        minInstances: 0,
        maxInstances: 100,
        concurrency: 80,
        timeoutSeconds: 300,
        ingress: "all",
        env: {},
        allowUnauthenticated: false,
      },
    };
  },

  /** イメージ・メモリ・インスタンス数・同時実行数・タイムアウト・環境変数を検証する。 */
  collectErrors(form: RunServiceEditForm): FieldErrors<RunServiceEditForm> {
    const trimmedImage = form.image.trim();
    const imageError: Option<string> =
      trimmedImage === ""
        ? Option.some("コンテナ イメージの URL を入力してください")
        : /\s/.test(trimmedImage)
          ? Option.some("コンテナ イメージの URL に空白は含められません")
          : Option.none;

    const memMb = parseMemoryMb(form.memory);
    const cpuNum = Number(form.cpu);
    const memoryError: Option<string> = !Option.isSome(memMb)
      ? Option.some("128Mi〜32Gi の形式で指定してください（例: 512Mi, 1Gi）")
      : memMb.value > cpuNum * 8192
        ? Option.some(`CPU ${form.cpu} に対してメモリは最大 ${cpuNum * 8}Gi までです`)
        : Option.none;

    const min = integerOf(form.minInstances.trim());
    const max = integerOf(form.maxInstances.trim());
    const minError = intRangeError(form.minInstances, 0, 1000);
    const maxError: Option<string> = (() => {
      const rangeErr = intRangeError(form.maxInstances, 1, 1000);
      if (Option.isSome(rangeErr)) return rangeErr;
      if (Option.isSome(min) && Option.isSome(max) && max.value < min.value) {
        return Option.some("最大インスタンス数は最小インスタンス数以上にしてください");
      }
      return Option.none;
    })();

    const envResult = parseEnvVars(form.envVars);
    const envError = Result.isOk(envResult) ? Option.none : Option.some(envResult.error);

    return collect<RunServiceEditForm>([
      ["image", imageError],
      ["memory", memoryError],
      ["minInstances", minError],
      ["maxInstances", maxError],
      ["concurrency", intRangeError(form.concurrency, 1, 1000)],
      ["timeout", intRangeError(form.timeout, 1, 3600)],
      ["envVars", envError],
    ]);
  },

  /** 変更された項目だけを含む `gcloud run services update` と IAM バインディング更新のステップを返す。 */
  toSteps(form: RunServiceEditForm, projectId: string): readonly CommandStep[] {
    const steps: CommandStep[] = [];
    const flags: string[] = [];

    const trimmedImage = form.image.trim();
    if (trimmedImage !== form.original.image) {
      flags.push(flag("image", trimmedImage));
    }
    if (Number(form.cpu) !== form.original.cpu) {
      flags.push(flag("cpu", form.cpu));
    }
    const memMb = parseMemoryMb(form.memory);
    if (!Option.isSome(memMb) || memMb.value !== form.original.memoryMb) {
      flags.push(flag("memory", form.memory.trim()));
    }
    const min = integerOf(form.minInstances.trim());
    if (!Option.isSome(min) || min.value !== form.original.minInstances) {
      flags.push(flag("min-instances", form.minInstances.trim()));
    }
    const max = integerOf(form.maxInstances.trim());
    if (!Option.isSome(max) || max.value !== form.original.maxInstances) {
      flags.push(flag("max-instances", form.maxInstances.trim()));
    }
    const concurrency = integerOf(form.concurrency.trim());
    if (!Option.isSome(concurrency) || concurrency.value !== form.original.concurrency) {
      flags.push(flag("concurrency", form.concurrency.trim()));
    }
    const timeout = integerOf(form.timeout.trim());
    if (!Option.isSome(timeout) || timeout.value !== form.original.timeoutSeconds) {
      flags.push(flag("timeout", form.timeout.trim()));
    }
    if (form.ingress !== form.original.ingress) {
      flags.push(flag("ingress", form.ingress));
    }
    const parsedEnv = parseEnvVars(form.envVars);
    if (Result.isOk(parsedEnv)) {
      if (!sameRecord(parsedEnv.value, form.original.env)) {
        const entries = Object.entries(parsedEnv.value);
        if (entries.length > 0) {
          flags.push(flag("set-env-vars", entries.map(([k, v]) => `${k}=${v}`).join(",")));
        } else {
          const removed = Object.keys(form.original.env);
          if (removed.length > 0) {
            flags.push(flag("remove-env-vars", removed.join(",")));
          }
        }
      }
    } else if (form.envVars.trim() !== formatEnvVars(form.original.env)) {
      flags.push(flag("set-env-vars", form.envVars.trim()));
    }

    if (flags.length > 0) {
      steps.push({
        line: [
          "gcloud run services update",
          quote(form.name),
          flag("region", form.region),
          flag("project", projectId),
          ...flags,
        ].join(" "),
        note: `Cloud Run サービスを更新 (${form.name})`,
      });
    }

    if (form.allowUnauthenticated !== form.original.allowUnauthenticated) {
      const action = form.allowUnauthenticated
        ? "add-iam-policy-binding"
        : "remove-iam-policy-binding";
      steps.push({
        line: [
          "gcloud run services",
          action,
          quote(form.name),
          flag("region", form.region),
          flag("project", projectId),
          "--member=allUsers",
          "--role=roles/run.invoker",
        ].join(" "),
        note: form.allowUnauthenticated
          ? `未認証の呼び出しを許可 (${form.name})`
          : `未認証の呼び出しを制限 (${form.name})`,
      });
    }

    return steps;
  },

  /** 同等のコマンドライン表示用。複数コマンドは改行で並べる。 */
  toCommand(form: RunServiceEditForm, projectId: string): string {
    const steps = RunServiceEditForm.toSteps(form, projectId);
    return steps.length === 0 ? NoChangesComment : steps.map((s) => s.line).join("\n");
  },
} as const;
