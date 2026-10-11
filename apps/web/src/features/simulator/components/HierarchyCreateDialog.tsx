import { type ReactElement, useEffect, useRef, useState } from "react";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SecondaryButton } from "@/components/SecondaryButton";
import { Select } from "@/components/Select";
import { TextInput } from "@/components/TextInput";
import { type ParentRef, PolicyTarget } from "@/engine/domains/resource-hierarchy";
import { World } from "@/engine/domains/world";
import type { HierarchyCreation } from "@/features/simulator/domains/hierarchy-create";
import { HierarchyCreate } from "@/features/simulator/domains/hierarchy-create";
import { Option } from "@/utils/Option";

type Props = Readonly<{
  world: World;
  initialParent: ParentRef;
  error: Option<string>;
  onSubmit: (input: HierarchyCreation) => void;
  onClose: () => void;
}>;

const parentLabel = (world: World, parent: ParentRef): string =>
  World.ancestry(world, parent)
    .toReversed()
    .map((item) => {
      if (item.type === "organization") {
        return Option.unwrapOr(
          Option.map(
            World.findOrganization(world, item.id),
            (organization) => organization.displayName,
          ),
          item.id,
        );
      }
      return Option.unwrapOr(
        Option.map(World.findFolder(world, item.id), (folder) => folder.displayName),
        item.id,
      );
    })
    .join(" / ");

export const HierarchyCreateDialog = ({
  world,
  initialParent,
  error,
  onSubmit,
  onClose,
}: Props): ReactElement => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<HierarchyCreation["kind"]>("project");
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [parent, setParent] = useState(initialParent);
  const [setAsDefault, setDefault] = useState(true);
  const parents: readonly ParentRef[] = [
    ...World.organizations(world).map(
      (organization): ParentRef => ({ type: "organization", id: organization.id }),
    ),
    ...world.folders.map((folder): ParentRef => ({ type: "folder", id: folder.id })),
  ];
  const input: HierarchyCreation =
    kind === "organization" ? { kind, name } : { kind, name, parent, projectId, setAsDefault };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    // jsdom では showModal が無いため、open 属性で同じ内容を描く。
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
      return () => dialog.close();
    }
    dialog.setAttribute("open", "");
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label="リソースを作成"
      aria-modal="true"
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-xl border border-line bg-surface p-6 text-ink shadow-xl backdrop:bg-ink/30"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(input);
        }}
      >
        <h2 className="mb-5 font-bold text-xl">リソースを作成</h2>
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-sm text-muted">種類</p>
            <Select
              ariaLabel="作成する種類"
              value={kind}
              onChange={setKind}
              font="sans"
              options={[
                { value: "project", label: "プロジェクト" },
                { value: "folder", label: "フォルダ" },
                { value: "organization", label: "組織（学習用）" },
              ]}
            />
          </div>
          <div>
            <label htmlFor="hierarchy-name" className="mb-2 block text-sm text-muted">
              名前
            </label>
            <TextInput
              id="hierarchy-name"
              value={name}
              onChange={setName}
              font="sans"
              placeholder={kind === "organization" ? "example.org" : "学習環境"}
            />
          </div>
          {kind === "project" && (
            <div>
              <label htmlFor="hierarchy-project-id" className="mb-2 block text-sm text-muted">
                プロジェクト ID
              </label>
              <TextInput
                id="hierarchy-project-id"
                value={projectId}
                onChange={setProjectId}
                placeholder="my-learning-project"
              />
              <p className="mt-2 text-muted text-xs">
                6〜30文字の小文字英数字・ハイフン。英字で始め、末尾にハイフンは使えません。
              </p>
            </div>
          )}
          {kind !== "organization" && (
            <div>
              <p className="mb-2 text-sm text-muted">作成先</p>
              <Select
                ariaLabel="作成先"
                value={PolicyTarget.toPath(parent)}
                options={parents.map((item) => ({
                  value: PolicyTarget.toPath(item),
                  label: `${item.type === "organization" ? "組織" : "フォルダ"}: ${parentLabel(world, item)} (${item.id})`,
                }))}
                onChange={(value) => {
                  const chosen = parents.find((item) => PolicyTarget.toPath(item) === value);
                  if (chosen !== undefined) {
                    setParent(chosen);
                  }
                }}
                font="sans"
              />
            </div>
          )}
          {kind === "project" && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={setAsDefault}
                onChange={(event) => setDefault(event.target.checked)}
                className="accent-accent"
              />
              作成したプロジェクトに切り替える
            </label>
          )}
          {kind === "organization" && (
            <p className="rounded-lg bg-code p-3 text-sm leading-relaxed">
              シミュレータ内の学習用組織を追加します。組織 ID
              は自動で割り当てられ、現在のプリンシパルが所有者になります。
            </p>
          )}
          {input.kind !== "organization" && (
            <div>
              <p className="mb-2 text-muted text-sm">実行するコマンド</p>
              <pre className="whitespace-pre-wrap break-all rounded-lg bg-code p-3 font-mono text-xs">
                {HierarchyCreate.command(input)}
              </pre>
            </div>
          )}
          {Option.isSome(error) && (
            <p
              role="alert"
              className="whitespace-pre-wrap rounded-lg bg-danger-soft p-3 text-danger text-sm"
            >
              {error.value}
            </p>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <SecondaryButton onClick={onClose}>キャンセル</SecondaryButton>
          <PrimaryButton onClick={() => onSubmit(input)}>作成</PrimaryButton>
        </div>
      </form>
    </dialog>
  );
};
