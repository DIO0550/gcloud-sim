import { TerraformState } from "@/engine/domains/terraform";
import { TfRuntime } from "@/engine/domains/terraform/runtime";
import { NotFound, Section, type SelectionProps } from "./PropertyParts";

const outputRows = (outputs: Readonly<Record<string, string>>, sensitive: readonly string[]) =>
  Object.entries(outputs).map(([label, value]) => ({
    label,
    value: sensitive.includes(label) ? "(sensitive value)" : value,
  }));
export const TerraformProperties = ({ world, selection }: SelectionProps<"terraform">) => {
  const state = world.terraform;
  if (selection.collection === "files") {
    const content = state.files[selection.name];
    if (content === undefined) {
      return <NotFound what="仮想ファイル" />;
    }
    if (selection.name.endsWith(".tfstate")) {
      return (
        <>
          <Section
            title="stateバックアップ"
            rows={[
              { label: "ファイル", value: selection.name },
              { label: "文字数", value: content.length },
            ]}
          />
          <p className="text-sm text-warn-ink">
            stateには機密outputの値も保存されます。内容は sim files read
            で確認できます。アクセスを制限し、Gitへ登録しないでください。
          </p>
        </>
      );
    }
    return (
      <>
        <Section title="仮想ファイル" rows={[{ label: "ファイル", value: selection.name }]} />
        <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
          {content}
        </pre>
      </>
    );
  }
  if (selection.collection === "resources") {
    const resource = state.resources.find((r) => r.address === selection.name);
    if (!resource) {
      return <NotFound what="管理対象" />;
    }
    return (
      <Section
        title="stateの管理対象"
        rows={Object.entries(TerraformState.record(resource)).map(([label, value]) => ({
          label,
          value: typeof value === "object" ? JSON.stringify(value) : String(value),
        }))}
      />
    );
  }
  if (selection.collection === "plans") {
    const plan = state.plans[selection.name];
    if (!plan) {
      return <NotFound what="保存plan" />;
    }
    return (
      <>
        <Section
          title="保存plan"
          rows={[
            { label: "モード", value: plan.mode },
            { label: "serial", value: plan.serial },
            { label: "backend revision", value: plan.backendRevision },
            {
              label: "状態",
              value:
                plan.serial === state.serial && plan.backendRevision === state.backend.revision
                  ? "現在のstateから作成（実リソースも適用時に再検証）"
                  : "古いplan・適用不可",
            },
          ]}
        />
        <pre className="whitespace-pre-wrap break-all font-mono text-xs">
          {TfRuntime.summary(plan)}
        </pre>
        <Section title="予定output" rows={outputRows(plan.outputs, plan.sensitiveOutputs)} />
      </>
    );
  }
  const backend = state.backend.config;
  const remote = state.backend.remotes.find(
    (r) =>
      backend.kind === "gcs" &&
      r.config.bucket === backend.bucket &&
      r.config.prefix === backend.prefix,
  );
  return (
    <>
      <Section
        title="Terraform作業領域"
        rows={[
          { label: "初期化", value: state.initialized ? "完了" : "未実施" },
          { label: "google provider", value: state.providerVersion || "未選択" },
          { label: "serial", value: state.serial },
          {
            label: "backend",
            value:
              backend.kind === "gcs"
                ? `gs://${backend.bucket}/${backend.prefix}/default.tfstate`
                : "local",
          },
          { label: "管理対象", value: state.resources.length },
          { label: "保存plan", value: Object.keys(state.plans).length },
          {
            label: "復旧可能な世代",
            value: remote?.versions.map((v) => v.generation).join(", ") || "(none)",
          },
          {
            label: "演習記録",
            value: state.events.map((e) => `${e.kind}: serial ${e.serial}`).join(", ") || "(none)",
          },
        ]}
      />
      <Section
        title="output（機密値をマスク）"
        rows={outputRows(state.outputs, state.sensitiveOutputs)}
      />
      <p className="text-sm text-muted">
        仮想作業領域の教材用実装です。provider・moduleのダウンロードや実クラウドへの通信は行いません。
      </p>
    </>
  );
};
