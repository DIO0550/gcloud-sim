import { CommonSteps } from "./common";
import type { MissionGuide } from "./model";

export const ComputeGuides = {
  "compute-custom": {
    introduction:
      "固定のマシンタイプではCPUとメモリが合わない場合に、それぞれを指定したカスタムVMを作ります。",
    steps: [
      CommonSteps.prepareCompute,
      {
        title: "必要なCPUとメモリを組み合わせる",
        explanation: "N2系列で4 vCPU、12 GiBのメモリを持つVMを作ります。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute instances create custom-worker --zone=us-central1-a --custom-vm-type=n2 --custom-cpu=4 --custom-memory=12GB",
          },
        ],
        points: [
          {
            term: "--custom-vm-type=n2",
            description: "カスタムVMを構成するマシン系列です。",
          },
          {
            term: "--custom-cpu=4",
            description: "仮想CPUの数を4にします。",
          },
          {
            term: "--custom-memory=12GB",
            description: "メモリ容量を指定します。CPU数と独立して値を決めます。",
          },
        ],
        expected: "custom-workerが作成されます。",
      },
      {
        title: "生成されたマシン構成を確認する",
        explanation: "指定した値から作られたマシンタイプを確認します。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute instances describe custom-worker --zone=us-central1-a",
          },
        ],
        points: [
          {
            term: "machineType",
            description:
              "カスタム構成では系列・CPU数・メモリ容量を含む名前になります。メモリは出力上MiB単位で表されることがあります。",
          },
        ],
        expected: "N2、4 vCPU、12 GiBに対応するマシン構成です。",
      },
    ],
    takeaway:
      "CPU数・メモリ量・マシン系列を組み合わせて指定します。カスタムVMも配置ゾーンを持ちます。",
  },
  "compute-gpu": {
    introduction:
      "GPUを付けるときは、GPUの種類だけでなく対応マシンとホスト保守時の動作も組み合わせて指定します。",
    steps: [
      CommonSteps.prepareCompute,
      {
        title: "T4を1基持つVMを作る",
        explanation: "この演習で対応するus-central1-aのN1マシンに、T4を1基接続します。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute instances create gpu-worker --zone=us-central1-a --machine-type=n1-standard-1 --accelerator=type=nvidia-tesla-t4,count=1 --maintenance-policy=TERMINATE",
          },
        ],
        points: [
          {
            term: "--accelerator",
            description: "GPUの型typeと台数countをまとめて指定します。",
          },
          {
            term: "--machine-type=n1-standard-1",
            description: "GPUを付けるVM本体の構成です。",
          },
          {
            term: "--maintenance-policy=TERMINATE",
            description:
              "ホスト保守時はVMを停止させる指定です。この構成でMIGRATEを使わない点を確認します。",
          },
        ],
        expected: "GPU付きのgpu-workerが作成されます。",
      },
      {
        title: "GPUと保守設定を読み返す",
        explanation: "GPU台数とスケジューリング設定を確認します。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute instances describe gpu-worker --zone=us-central1-a",
          },
        ],
        points: [
          {
            term: "guestAcceleratorsとscheduling",
            description: "アクセラレーターの型・数と、ホスト保守時の設定を確認する箇所です。",
          },
        ],
        expected: "T4が1基で、onHostMaintenanceがTERMINATEです。",
      },
    ],
    takeaway:
      "GPUのアクセラレーター指定と、CPU側マシンの指定は別です。保守時に移行できるかも構成条件になります。",
  },
  "compute-tpu": {
    introduction:
      "TPU VMを専用のサービスアカウントで動かします。先にそのアカウントを使ってVMを作成できる権限を準備します。",
    steps: [
      {
        title: "操作するプロジェクトとAPIを準備する",
        explanation:
          "最初に操作する本人と対象プロジェクトを固定します。以降のコマンドで対象を省略しても、ここで選んだ環境に作用します。",
        actions: [
          {
            kind: "command",
            text: "gcloud config set account owner@example.com",
          },
          {
            kind: "command",
            text: "gcloud config set project ace-dev-01",
          },
          {
            kind: "command",
            text: "gcloud services enable compute.googleapis.com tpu.googleapis.com",
          },
        ],
        points: [
          {
            term: "configuration",
            description:
              "gcloudの接続先や既定値をまとめた設定です。set accountは操作主体、set projectは対象を選びます。",
          },
          {
            term: "services enable",
            description:
              "サービスのAPIをプロジェクトで利用可能にします。IAMの権限付与とは別の操作です。",
          },
        ],
        expected:
          "アカウントはowner@example.com、プロジェクトはace-dev-01です。APIの有効化が成功してから次へ進みます。",
      },
      {
        title: "専用の実行主体と利用権限を作る",
        explanation:
          "VMが使うアカウントを作り、ownerがそのアカウントを割り当てられるようにします。",
        actions: [
          {
            kind: "command",
            text: "gcloud iam service-accounts create vm-worker",
          },
          {
            kind: "command",
            text: "gcloud iam service-accounts add-iam-policy-binding vm-worker@ace-dev-01.iam.gserviceaccount.com --member=user:owner@example.com --role=roles/iam.serviceAccountUser",
          },
        ],
        points: [
          {
            term: "roles/iam.serviceAccountUser",
            description:
              "そのサービスアカウントをリソースへ割り当てるためのactAs権限を含みます。VMへ全権限を与えるロールではありません。",
          },
        ],
        expected: "vm-workerが作成され、ownerに利用権限が付きます。",
      },
      {
        title: "TPUの種類と対応ゾーンを指定する",
        explanation: "演習の対応するゾーンでv2-8を選び、専用アカウントを割り当てます。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute tpus tpu-vm create matrix-worker --zone=us-central1-b --accelerator-type=v2-8 --version=tpu-vm-base --service-account=vm-worker@ace-dev-01.iam.gserviceaccount.com",
          },
          {
            kind: "command",
            text: "gcloud compute tpus tpu-vm describe matrix-worker --zone=us-central1-b",
          },
        ],
        points: [
          {
            term: "--accelerator-type=v2-8",
            description: "TPUのアクセラレーター構成です。",
          },
          {
            term: "--version=tpu-vm-base",
            description: "TPU VM用のソフトウェア環境です。",
          },
          {
            term: "--service-account",
            description: "このVMの処理を識別する実行主体です。",
          },
        ],
        expected: "matrix-workerがus-central1-bにあり、v2-8とvm-workerが設定されています。",
      },
    ],
    takeaway:
      "サービスアカウントの実行時権限と、作成者がそのアカウントをVMへ割り当てるactAs権限は別です。",
  },
  "compute-regional": {
    introduction:
      "1つのゾーンだけに置くディスクと異なり、リージョン内の2ゾーンへ複製するディスクをVMへ接続します。",
    steps: [
      CommonSteps.prepareCompute,
      {
        title: "接続先VMを用意する",
        explanation: "複製先の1つであるus-central1-aにVMを作ります。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute instances create ha-worker --zone=us-central1-a",
          },
        ],
        points: [
          {
            term: "--zone",
            description: "VMはゾーンに属します。次に作るディスクの複製先と整合する場所を選びます。",
          },
        ],
        expected: "ha-workerがus-central1-aで動作します。",
      },
      {
        title: "2つの複製先を持つディスクを作る",
        explanation: "SSD 200 GiBのregionalディスクを用意します。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute disks create mirrored --region=us-central1 --replica-zones=us-central1-a,us-central1-b --type=pd-ssd --size=200GB",
          },
        ],
        points: [
          {
            term: "--region",
            description: "ディスクをリージョンリソースとして作ります。",
          },
          {
            term: "--replica-zones",
            description: "同じリージョンの複製先を2つ指定します。",
          },
          {
            term: "--type=pd-ssd",
            description: "永続ディスクのSSDタイプです。",
          },
        ],
        expected: "mirroredが2ゾーンの複製先を持ちます。",
      },
      {
        title: "regionalとして接続し確認する",
        explanation:
          "同じ名前のゾーンディスクを探してしまわないよう、ディスクのスコープを指定します。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute instances attach-disk ha-worker --zone=us-central1-a --disk=mirrored --disk-scope=regional",
          },
          {
            kind: "command",
            text: "gcloud compute disks describe mirrored --region=us-central1",
          },
        ],
        points: [
          {
            term: "--disk-scope=regional",
            description: "接続するディスクをリージョンから解決します。--zoneは接続先VMの場所です。",
          },
        ],
        expected:
          "mirroredのusersにha-workerがあり、複製先がaとbです。この演習では実際のゾーン障害は発生させません。",
      },
    ],
    takeaway:
      "regionalディスクはregionで識別します。接続時もdisk-scopeをregionalにして、ゾーンディスクと区別します。",
  },
  "compute-hyperdisk": {
    introduction:
      "容量だけで性能を決めず、IOPSとスループットを独立して指定するHyperdiskを作ります。",
    steps: [
      CommonSteps.prepareCompute,
      {
        title: "接続可能なマシンを用意する",
        explanation: "この演習でHyperdiskに対応するC3マシンを作成します。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute instances create io-worker --zone=us-central1-a --machine-type=c3-standard-4",
          },
        ],
        points: [
          {
            term: "--machine-type=c3-standard-4",
            description: "Hyperdiskと組み合わせるVMの系列と構成を選びます。",
          },
        ],
        expected: "io-workerが作成されます。",
      },
      {
        title: "容量と2種類の性能を指定する",
        explanation: "100 GiB、10000 IOPS、400 MiB/sをそれぞれ指定します。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute disks create fast-data --zone=us-central1-a --type=hyperdisk-balanced --size=100GB --provisioned-iops=10000 --provisioned-throughput=400",
          },
        ],
        points: [
          {
            term: "--size",
            description: "データを置ける容量です。",
          },
          {
            term: "--provisioned-iops",
            description: "1秒あたりの入出力操作回数を指定します。",
          },
          {
            term: "--provisioned-throughput",
            description: "1秒あたりのデータ転送量を指定します。",
          },
        ],
        expected: "fast-dataに容量と性能が保存されます。",
      },
      {
        title: "VMへ接続して構成を確認する",
        explanation: "ディスクは作成だけではVMから使われません。接続先を指定して割り当てます。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute instances attach-disk io-worker --zone=us-central1-a --disk=fast-data",
          },
          {
            kind: "command",
            text: "gcloud compute disks describe fast-data --zone=us-central1-a",
          },
        ],
        points: [
          {
            term: "attach-disk",
            description: "独立して作ったデータディスクをVMへ接続します。",
          },
        ],
        expected: "usersがio-workerを指し、100 GiB、10000 IOPS、400の設定が確認できます。",
      },
    ],
    takeaway:
      "IOPSは単位時間あたりの入出力回数、スループットはデータ転送量です。容量とは別の指標です。",
  },
} satisfies Readonly<Record<string, MissionGuide>>;
