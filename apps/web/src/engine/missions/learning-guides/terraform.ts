import { CommonSteps } from "./common";
import type { MissionGuide } from "./model";

export const TerraformGuides = {
  "m-terraform-001": {
    introduction:
      "HCLでネットワークの望ましい状態を書き、検証・計画・反映・再確認の順で構築します。",
    steps: [
      CommonSteps.prepareCompute,
      CommonSteps.loadTerraformNetwork,
      CommonSteps.initializeTerraform,
      {
        title: "変更計画を確認してから適用する",
        explanation:
          "まず作成・更新・削除の予定をplanへ保存し、その内容を読んでから同じplanを適用します。",
        actions: [
          {
            kind: "command",
            text: "terraform plan -out=tfplan",
          },
          {
            kind: "command",
            text: "terraform show tfplan",
          },
          {
            kind: "command",
            text: "terraform apply tfplan",
          },
        ],
        points: [
          {
            term: "-out=tfplan",
            description:
              "計画をファイルへ保存します。applyへこのファイル名を渡すと、確認した計画を適用できます。",
          },
          {
            term: "planとapply",
            description:
              "planは予定の確認、applyは実リソースとstateへの反映です。保存済みplanを渡す場合は追加のyes確認はありません。",
          },
        ],
        expected:
          "planに表示された対象が反映されます。変更不要のリソースまで削除・置換されていないことを確認します。",
      },
      CommonSteps.checkTerraformState,
    ],
    takeaway: "Terraformはコマンドで1件ずつ作るだけでなく、構成とstateの対応を維持します。",
  },
  "m-terraform-002": {
    introduction: "まず元のネットワークを構築し、変数とHCLを変更して設定変更の差分を確認します。",
    steps: [
      CommonSteps.prepareCompute,
      CommonSteps.loadTerraformNetwork,
      CommonSteps.initializeTerraform,
      CommonSteps.applyInitialTerraformPlan,
      {
        title: "CIDRとPrivate Google Accessを変更する",
        explanation:
          "terraform.tfvarsで変数を上書きし、main.tfでPrivate Google Accessを有効にします。",
        actions: [
          {
            kind: "write",
            name: "terraform.tfvars",
            content: 'subnet_cidr = "10.43.0.0/24"\n',
          },
          {
            kind: "replace",
            name: "main.tf",
            before: "private_ip_google_access = false",
            after: "private_ip_google_access = true",
          },
        ],
        points: [
          {
            term: "terraform.tfvars",
            description:
              "変数の既定値を上書きする入力ファイルです。この名前は自動で読み込まれます。",
          },
          {
            term: "private_ip_google_access",
            description: "外部IPを持たないVMからGoogle APIへアクセスするためのサブネット設定です。",
          },
        ],
        expected:
          "ファイルに新しいCIDRとtrueが保存されます。まだ実リソースへは反映されていません。",
      },
      {
        title: "CIDRとアクセス設定の変更を反映する",
        explanation:
          "まず作成・更新・削除の予定をplanへ保存し、その内容を読んでから同じplanを適用します。",
        actions: [
          {
            kind: "command",
            text: "terraform plan -out=change-plan",
          },
          {
            kind: "command",
            text: "terraform show change-plan",
          },
          {
            kind: "command",
            text: "terraform apply change-plan",
          },
        ],
        points: [
          {
            term: "-out=change-plan",
            description:
              "計画をファイルへ保存します。applyへこのファイル名を渡すと、確認した計画を適用できます。",
          },
          {
            term: "planとapply",
            description:
              "planは予定の確認、applyは実リソースとstateへの反映です。保存済みplanを渡す場合は追加のyes確認はありません。",
          },
        ],
        expected:
          "planに表示された対象が反映されます。変更不要のリソースまで削除・置換されていないことを確認します。",
      },
      CommonSteps.checkTerraformState,
    ],
    takeaway:
      "変数ファイルは入力値を、resourceの設定は機能の有効・無効を決めます。編集だけでは実リソースは変わりません。",
  },
  "m-terraform-003": {
    introduction: "Terraform以外で作られたVPCを、再作成せずに管理対象へ取り込みます。",
    steps: [
      CommonSteps.prepareCompute,
      {
        title: "Terraform外でVPCを作る",
        explanation: "既存リソースを取り込むため、今回はgcloudで先に作ります。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute networks create tf-import-net --subnet-mode=custom",
          },
        ],
        points: [
          {
            term: "管理外のリソース",
            description:
              "クラウド上には存在しますが、まだTerraformのstateと結び付いていない状態です。",
          },
        ],
        expected: "tf-import-netが作成されます。",
      },
      {
        title: "対応する定義と認証を用意する",
        explanation: "取り込み先のアドレスを定義してから初期化します。",
        actions: [
          {
            kind: "write",
            name: "import.tf",
            content:
              'resource "google_compute_network" "imported" {\n  project = "ace-dev-01"\n  name = "tf-import-net"\n  auto_create_subnetworks = false\n}\n',
          },
          {
            kind: "command",
            text: "gcloud auth application-default login",
          },
          {
            kind: "command",
            text: "terraform init",
          },
        ],
        points: [
          {
            term: "import.tf",
            description:
              "拡張子.tfのファイルは構成として読み込まれます。クラウドのVPC名とHCLのnameを合わせます。",
          },
        ],
        expected: "resource importedの定義が読み込まれます。",
      },
      CommonSteps.importExistingNetwork,
      CommonSteps.checkTerraformState,
    ],
    takeaway:
      "importするには、既存リソースと一致するHCLを先に用意します。import自体が任意の構成を生成する前提にはしません。",
  },
  "m-terraform-004": {
    introduction: "先に作ったVPCとサブネットを保ち、Terraform内の構成だけをmoduleへ整理します。",
    steps: [
      CommonSteps.prepareCompute,
      CommonSteps.loadTerraformNetwork,
      CommonSteps.initializeTerraform,
      {
        title: "変更計画を確認してから適用する",
        explanation:
          "まず作成・更新・削除の予定をplanへ保存し、その内容を読んでから同じplanを適用します。",
        actions: [
          {
            kind: "command",
            text: "terraform plan -out=before-move-plan",
          },
          {
            kind: "command",
            text: "terraform show before-move-plan",
          },
          {
            kind: "command",
            text: "terraform apply before-move-plan",
          },
        ],
        points: [
          {
            term: "-out=before-move-plan",
            description:
              "計画をファイルへ保存します。applyへこのファイル名を渡すと、確認した計画を適用できます。",
          },
          {
            term: "planとapply",
            description:
              "planは予定の確認、applyは実リソースとstateへの反映です。保存済みplanを渡す場合は追加のyes確認はありません。",
          },
        ],
        expected:
          "planに表示された対象が反映されます。変更不要のリソースまで削除・置換されていないことを確認します。",
      },
      CommonSteps.moveNetworkIntoModule,
      CommonSteps.checkTerraformState,
    ],
    takeaway:
      "HCLの置き場所を変えるとアドレスも変わります。movedで対応を伝え、削除と再作成を防ぎます。",
  },
  "m-terraform-005": {
    introduction:
      "ネットワーク、サブネット、VM、firewall、bucketを、依存関係のある1つの構成として適用します。",
    steps: [
      CommonSteps.prepareComputeStorage,
      CommonSteps.loadTerraformInfrastructure,
      CommonSteps.initializeTerraform,
      {
        title: "変更計画を確認してから適用する",
        explanation:
          "まず作成・更新・削除の予定をplanへ保存し、その内容を読んでから同じplanを適用します。",
        actions: [
          {
            kind: "command",
            text: "terraform plan -out=infra-plan",
          },
          {
            kind: "command",
            text: "terraform show infra-plan",
          },
          {
            kind: "command",
            text: "terraform apply infra-plan",
          },
        ],
        points: [
          {
            term: "-out=infra-plan",
            description:
              "計画をファイルへ保存します。applyへこのファイル名を渡すと、確認した計画を適用できます。",
          },
          {
            term: "planとapply",
            description:
              "planは予定の確認、applyは実リソースとstateへの反映です。保存済みplanを渡す場合は追加のyes確認はありません。",
          },
        ],
        expected:
          "planに表示された対象が反映されます。変更不要のリソースまで削除・置換されていないことを確認します。",
      },
      {
        title: "5つの管理対象と実設定を照合する",
        explanation: "stateだけでなく、gcloudでもVMとbucketの実際の構成を確認します。",
        actions: [
          {
            kind: "command",
            text: "terraform state list",
          },
          {
            kind: "command",
            text: "gcloud compute instances describe tf-lab-vm --zone=us-central1-a",
          },
          {
            kind: "command",
            text: "gcloud storage buckets describe gs://ace-dev-01-tf-lab-assets",
          },
        ],
        points: [
          {
            term: "stateとdescribeの比較",
            description: "stateのアドレスと、クラウド上の名前・設定を対応付けます。",
          },
        ],
        expected: "stateに5リソースがあり、VMはe2-micro、bucketには指定した保護設定があります。",
      },
    ],
    takeaway:
      "同じplanに複数サービスのリソースを含められます。構成・state・実リソースの3つを照合します。",
  },
  "m-terraform-006": {
    introduction: "作成済みの5リソースを対象に、destroy planを確認して依存関係の逆順で片付けます。",
    steps: [
      CommonSteps.prepareComputeStorage,
      CommonSteps.loadTerraformInfrastructure,
      CommonSteps.initializeTerraform,
      {
        title: "変更計画を確認してから適用する",
        explanation:
          "まず作成・更新・削除の予定をplanへ保存し、その内容を読んでから同じplanを適用します。",
        actions: [
          {
            kind: "command",
            text: "terraform plan -out=create-plan",
          },
          {
            kind: "command",
            text: "terraform show create-plan",
          },
          {
            kind: "command",
            text: "terraform apply create-plan",
          },
        ],
        points: [
          {
            term: "-out=create-plan",
            description:
              "計画をファイルへ保存します。applyへこのファイル名を渡すと、確認した計画を適用できます。",
          },
          {
            term: "planとapply",
            description:
              "planは予定の確認、applyは実リソースとstateへの反映です。保存済みplanを渡す場合は追加のyes確認はありません。",
          },
        ],
        expected:
          "planに表示された対象が反映されます。変更不要のリソースまで削除・置換されていないことを確認します。",
      },
      {
        title: "削除の計画を保存して確認する",
        explanation: "空の環境から始めず、直前に作った5リソースを削除対象として計画します。",
        actions: [
          {
            kind: "command",
            text: "terraform plan -destroy -out=cleanup-plan",
          },
          {
            kind: "command",
            text: "terraform show cleanup-plan",
          },
        ],
        points: [
          {
            term: "-destroy",
            description:
              "作成ではなく管理対象を削除する計画を作ります。この時点ではまだ削除しません。",
          },
          {
            term: "依存順序",
            description:
              "VMやfirewallなどの利用側を先に、subnetやVPCなどの参照先を後に削除します。",
          },
        ],
        expected: "5リソースを削除する計画で、対象外のリソースが含まれていません。",
      },
      {
        title: "確認した削除計画を適用する",
        explanation: "保存したplanを指定して削除し、stateに対象が残っていないことを確認します。",
        actions: [
          {
            kind: "command",
            text: "terraform apply cleanup-plan",
          },
          {
            kind: "command",
            text: "terraform state list",
          },
        ],
        points: [
          {
            term: "apply cleanup-plan",
            description:
              "保存したdestroy planの削除を実行します。通常の作成planにもapplyを使うので、どのplanかを確認します。",
          },
        ],
        expected: "5リソースが削除され、state listが空になります。",
      },
    ],
    takeaway: "state rmは管理の対応だけを外します。実リソースの削除にはdestroyの計画を適用します。",
  },
  "m-terraform-007": {
    introduction:
      "まずローカルstateでネットワークを作り、その対応関係を保持したままGCSへ保存先を変えます。",
    steps: [
      CommonSteps.prepareComputeStorage,
      CommonSteps.loadTerraformNetwork,
      CommonSteps.initializeTerraform,
      {
        title: "変更計画を確認してから適用する",
        explanation:
          "まず作成・更新・削除の予定をplanへ保存し、その内容を読んでから同じplanを適用します。",
        actions: [
          {
            kind: "command",
            text: "terraform plan -out=local-plan",
          },
          {
            kind: "command",
            text: "terraform show local-plan",
          },
          {
            kind: "command",
            text: "terraform apply local-plan",
          },
        ],
        points: [
          {
            term: "-out=local-plan",
            description:
              "計画をファイルへ保存します。applyへこのファイル名を渡すと、確認した計画を適用できます。",
          },
          {
            term: "planとapply",
            description:
              "planは予定の確認、applyは実リソースとstateへの反映です。保存済みplanを渡す場合は追加のyes確認はありません。",
          },
        ],
        expected:
          "planに表示された対象が反映されます。変更不要のリソースまで削除・置換されていないことを確認します。",
      },
      CommonSteps.createTerraformStateBucket,
      CommonSteps.migrateTerraformState,
    ],
    takeaway:
      "stateの移行は、リソースの移設や再作成ではありません。移行前後で管理するアドレスが同じか確認します。",
  },
  "m-terraform-008": {
    introduction: "変数ファイルで台数を2へ上書きし、countを使って同じ定義から2台のVMを作ります。",
    steps: [
      CommonSteps.prepareCompute,
      {
        title: "構成ファイルを読み、管理する対象を確認する",
        explanation:
          "main.tfとlesson.tfvarsを開き、vm_countの既定値1が入力ファイルで2へ上書きされることを確認します。",
        actions: [
          {
            kind: "load",
            name: "terraform-auto",
            overwrite: true,
          },
        ],
        points: [
          {
            term: "count = var.vm_count",
            description: "VM resourceを入力した台数だけ作成します。",
          },
          {
            term: "count.index",
            description: "0から始まる添字です。VM名の式では+1してtf-auto-1、tf-auto-2にします。",
          },
          {
            term: "auto_create_subnetworks = true",
            description: "各リージョンのサブネットを自動作成するVPCです。",
          },
        ],
        expected:
          "ファイルタブでmain.tfを開き、resourceの名前・参照先・変数を確認してからCLIへ戻ります。",
      },
      CommonSteps.initializeTerraform,
      {
        title: "変更計画を確認してから適用する",
        explanation:
          "まず作成・更新・削除の予定をplanへ保存し、その内容を読んでから同じplanを適用します。",
        actions: [
          {
            kind: "command",
            text: "terraform plan -var-file=lesson.tfvars -out=auto-plan",
          },
          {
            kind: "command",
            text: "terraform show auto-plan",
          },
          {
            kind: "command",
            text: "terraform apply auto-plan",
          },
        ],
        points: [
          {
            term: "-out=auto-plan",
            description:
              "計画をファイルへ保存します。applyへこのファイル名を渡すと、確認した計画を適用できます。",
          },
          {
            term: "planとapply",
            description:
              "planは予定の確認、applyは実リソースとstateへの反映です。保存済みplanを渡す場合は追加のyes確認はありません。",
          },
        ],
        expected:
          "planに表示された対象が反映されます。変更不要のリソースまで削除・置換されていないことを確認します。",
      },
      {
        title: "台数と変数を維持した次の差分を確認する",
        explanation: "同じ変数入力でplanを実行し、既定値の1へ戻す計画にならないようにします。",
        actions: [
          {
            kind: "command",
            text: "terraform state list",
          },
          {
            kind: "command",
            text: "terraform plan -var-file=lesson.tfvars",
          },
        ],
        points: [
          {
            term: "-var-file",
            description:
              "指定ファイルの変数値を今回の処理で使います。lesson.tfvarsはこのフラグなしでは自動読み込みされません。",
          },
        ],
        expected: "web[0]とweb[1]がstateにあり、同じ入力でNo changesです。",
      },
    ],
    takeaway:
      "countの各インスタンスは数値の添字で識別します。変数ファイルを指定したplanを、そのまま適用します。",
  },
  "m-terraform-009": {
    introduction:
      "mapのキーで管理するfor_eachを使い、既存のblueとgreenを作り直さずredだけを追加します。",
    steps: [
      CommonSteps.prepareCompute,
      {
        title: "構成ファイルを読み、管理する対象を確認する",
        explanation:
          "networks変数のblue/greenを確認します。resource名はeach.value、stateの識別はeach.keyに相当するmapのキーで決まります。",
        actions: [
          {
            kind: "load",
            name: "terraform-each",
            overwrite: true,
          },
        ],
        points: [
          {
            term: "for_each = var.networks",
            description: "mapの各キーに対してresourceを1つずつ作ります。",
          },
          {
            term: "each.value",
            description: "tf-blueなど、各キーに対応する値をクラウド上の名前に使います。",
          },
        ],
        expected:
          "ファイルタブでmain.tfを開き、resourceの名前・参照先・変数を確認してからCLIへ戻ります。",
      },
      CommonSteps.initializeTerraform,
      {
        title: "変更計画を確認してから適用する",
        explanation:
          "まず作成・更新・削除の予定をplanへ保存し、その内容を読んでから同じplanを適用します。",
        actions: [
          {
            kind: "command",
            text: "terraform plan -out=two-networks-plan",
          },
          {
            kind: "command",
            text: "terraform show two-networks-plan",
          },
          {
            kind: "command",
            text: "terraform apply two-networks-plan",
          },
        ],
        points: [
          {
            term: "-out=two-networks-plan",
            description:
              "計画をファイルへ保存します。applyへこのファイル名を渡すと、確認した計画を適用できます。",
          },
          {
            term: "planとapply",
            description:
              "planは予定の確認、applyは実リソースとstateへの反映です。保存済みplanを渡す場合は追加のyes確認はありません。",
          },
        ],
        expected:
          "planに表示された対象が反映されます。変更不要のリソースまで削除・置換されていないことを確認します。",
      },
      {
        title: "既存キーを残しredを追加する",
        explanation:
          "入力mapをblue、green、redにします。元のキーと値を変えないので、追加はredだけになるはずです。",
        actions: [
          {
            kind: "command",
            text: 'terraform plan -var=\'networks={ blue="tf-blue", green="tf-green", red="tf-red" }\' -out=each-plan',
          },
          {
            kind: "command",
            text: "terraform show each-plan",
          },
          {
            kind: "command",
            text: "terraform apply each-plan",
          },
          {
            kind: "command",
            text: "terraform state list",
          },
        ],
        points: [
          {
            term: "-var",
            description:
              "今回の処理の変数値を直接上書きします。HCLのdefault自体を書き換えるわけではありません。",
          },
          {
            term: "キー付きアドレス",
            description:
              'google_compute_network.lab["blue"]のように、mapのキーを含むアドレスで管理します。',
          },
        ],
        expected:
          "blue/greenの削除や再作成がなくredが追加され、stateに3つのキーがあります。今後のplanでもredを含む入力を使います。",
      },
    ],
    takeaway:
      "for_eachはキーが識別子です。順番ではなくキーを維持すると、既存リソースを安定して管理できます。",
  },
  "m-terraform-010": {
    introduction:
      "providerの別名とバージョン制約を読み、moduleへどの接続設定を渡すかを明示します。",
    steps: [
      CommonSteps.prepareCompute,
      {
        title: "構成ファイルを読み、管理する対象を確認する",
        explanation:
          "main.tfのrequired_providers、providerのalias、moduleのprovidersを順に読みます。公開module名を使う限定教材で、外部moduleはダウンロードしません。",
        actions: [
          {
            kind: "load",
            name: "terraform-registry",
            overwrite: true,
          },
        ],
        points: [
          {
            term: 'version = "~> 5.0"',
            description:
              "providerに許可するバージョン範囲です。教材では収録された5.45.0を使います。",
          },
          {
            term: 'alias = "lab"',
            description: "google providerの設定にlabという別名を付けます。",
          },
          {
            term: "providers = { google = google.lab }",
            description: "module内のgoogleへ、ルートの別名付き設定を渡します。",
          },
          {
            term: "moduleのversion",
            description: "module自体の版の条件であり、providerの版とは別です。",
          },
        ],
        expected:
          "ファイルタブでmain.tfを開き、resourceの名前・参照先・変数を確認してからCLIへ戻ります。",
      },
      CommonSteps.initializeTerraform,
      {
        title: "変更計画を確認してから適用する",
        explanation:
          "まず作成・更新・削除の予定をplanへ保存し、その内容を読んでから同じplanを適用します。",
        actions: [
          {
            kind: "command",
            text: "terraform plan -out=registry-plan",
          },
          {
            kind: "command",
            text: "terraform show registry-plan",
          },
          {
            kind: "command",
            text: "terraform apply registry-plan",
          },
        ],
        points: [
          {
            term: "-out=registry-plan",
            description:
              "計画をファイルへ保存します。applyへこのファイル名を渡すと、確認した計画を適用できます。",
          },
          {
            term: "planとapply",
            description:
              "planは予定の確認、applyは実リソースとstateへの反映です。保存済みplanを渡す場合は追加のyes確認はありません。",
          },
        ],
        expected:
          "planに表示された対象が反映されます。変更不要のリソースまで削除・置換されていないことを確認します。",
      },
      {
        title: "moduleの出力を確認する",
        explanation: "module内のresourceを、ルートで受け取るoutputとして確認します。",
        actions: [
          {
            kind: "command",
            text: "terraform output",
          },
          {
            kind: "command",
            text: "terraform state list",
          },
        ],
        points: [
          {
            term: "output",
            description:
              "他の構成や利用者に渡す値です。ここではmoduleのnetwork_idをルートのnetworkとして出しています。",
          },
        ],
        expected: "networkの出力とmodule.network配下の管理アドレスが確認できます。",
      },
    ],
    takeaway:
      "providerはGoogle Cloudの操作方法、moduleは構成のまとまりです。両方のバージョン指定を区別します。",
  },
  "m-terraform-014": {
    introduction:
      "gcloudで実設定を変えてドリフトを作り、stateへの取り込みと、HCLへ戻す修復を別々に行います。",
    steps: [
      CommonSteps.prepareCompute,
      CommonSteps.loadTerraformNetwork,
      CommonSteps.initializeTerraform,
      CommonSteps.applyInitialTerraformPlan,
      {
        title: "Terraformの外から実設定を変更する",
        explanation:
          "初期構成はPrivate Google Accessがfalseです。gcloudでtrueへ変え、構成と実設定のずれを作ります。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute networks subnets update tf-lab-subnet --region=us-central1 --enable-private-ip-google-access",
          },
        ],
        points: [
          {
            term: "ドリフト",
            description: "Terraformの構成やstateと、実際のリソースの設定がずれた状態です。",
          },
        ],
        expected: "クラウド上はtrueですが、main.tfはfalseのままです。",
      },
      {
        title: "実際の変更をstateへ取り込む",
        explanation: "実設定をHCLへ戻さず、現在の状態をstateへ反映する計画を適用します。",
        actions: [
          {
            kind: "command",
            text: "terraform plan -refresh-only -out=drift-plan",
          },
          {
            kind: "command",
            text: "terraform show drift-plan",
          },
          {
            kind: "command",
            text: "terraform apply drift-plan",
          },
        ],
        points: [
          {
            term: "-refresh-only",
            description:
              "外部変更をstateへ反映するモードです。HCLのfalseへリソースを戻す変更は行いません。",
          },
        ],
        expected: "stateはtrueを認識しますが、実設定はtrue、HCLはfalseのままです。",
      },
      {
        title: "HCLの設定へ戻す修復計画を適用する",
        explanation:
          "まず作成・更新・削除の予定をplanへ保存し、その内容を読んでから同じplanを適用します。",
        actions: [
          {
            kind: "command",
            text: "terraform plan -out=repair-plan",
          },
          {
            kind: "command",
            text: "terraform show repair-plan",
          },
          {
            kind: "command",
            text: "terraform apply repair-plan",
          },
        ],
        points: [
          {
            term: "-out=repair-plan",
            description:
              "計画をファイルへ保存します。applyへこのファイル名を渡すと、確認した計画を適用できます。",
          },
          {
            term: "planとapply",
            description:
              "planは予定の確認、applyは実リソースとstateへの反映です。保存済みplanを渡す場合は追加のyes確認はありません。",
          },
        ],
        expected:
          "planに表示された対象が反映されます。変更不要のリソースまで削除・置換されていないことを確認します。",
      },
      {
        title: "構成どおりに戻ったことを確認する",
        explanation: "通常applyで実リソースがfalseへ戻ったことを確認します。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute networks subnets describe tf-lab-subnet --region=us-central1",
          },
          {
            kind: "command",
            text: "terraform plan",
          },
        ],
        points: [
          {
            term: "通常のplan",
            description:
              "HCLを望ましい状態として比較するため、trueからfalseへ戻す変更が計画されます。",
          },
        ],
        expected: "Private Google Accessがfalseへ戻り、次のplanはNo changesです。",
      },
    ],
    takeaway:
      "refresh-onlyはstateの更新です。HCLの望ましい値に実リソースを戻すのは、その後の通常planです。",
  },
  "m-ace-challenge-terraform": {
    introduction:
      "ネットワークの新規構築、既存VPCの取り込み、moduleへの整理、GCSへのstate移行を一続きで行います。各段階で何を変更するかを見分けます。",
    steps: [
      CommonSteps.prepareComputeStorage,
      CommonSteps.loadTerraformNetwork,
      CommonSteps.initializeTerraform,
      {
        title: "変更計画を確認してから適用する",
        explanation:
          "まず作成・更新・削除の予定をplanへ保存し、その内容を読んでから同じplanを適用します。",
        actions: [
          {
            kind: "command",
            text: "terraform plan -out=ace-create-plan",
          },
          {
            kind: "command",
            text: "terraform show ace-create-plan",
          },
          {
            kind: "command",
            text: "terraform apply ace-create-plan",
          },
        ],
        points: [
          {
            term: "-out=ace-create-plan",
            description:
              "計画をファイルへ保存します。applyへこのファイル名を渡すと、確認した計画を適用できます。",
          },
          {
            term: "planとapply",
            description:
              "planは予定の確認、applyは実リソースとstateへの反映です。保存済みplanを渡す場合は追加のyes確認はありません。",
          },
        ],
        expected:
          "planに表示された対象が反映されます。変更不要のリソースまで削除・置換されていないことを確認します。",
      },
      {
        title: "取り込む既存VPCを追加する",
        explanation: "管理対象の2リソースを残したまま、Terraform外のVPCを1つ追加します。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute networks create tf-import-net --subnet-mode=custom",
          },
        ],
        points: [
          {
            term: "別々の管理状態",
            description:
              "新しいVPCはまだstateにありません。次のimportで3つ目の管理対象として登録します。",
          },
        ],
        expected: "tf-import-netがクラウド上に存在します。",
      },
      CommonSteps.importExistingNetwork,
      CommonSteps.moveNetworkIntoModule,
      CommonSteps.createTerraformStateBucket,
      CommonSteps.migrateTerraformState,
    ],
    takeaway:
      "applyは実設定の反映、importは既存実体との対応付け、movedは管理アドレスの移行、backend移行はstate保存先の変更です。",
  },
} satisfies Readonly<Record<string, MissionGuide>>;
