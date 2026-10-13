import { type ReactElement, useEffect, useState } from "react";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SecondaryButton } from "@/components/SecondaryButton";
import { ConfigurationFiles, type FileEdit } from "@/engine/domains/configuration-files";
import type { World } from "@/engine/domains/world";
import type { Result } from "@/utils/Result";

type FileWorkspaceProps = Readonly<{
  world: World;
  onEdit: (edit: FileEdit) => Result<void, string>;
}>;
const field = "w-full rounded border border-line bg-surface px-3 py-2 text-sm";

/** HCL・YAML・JSONを通常のファイルとして編集し、CLIから参照する。 */
export const FileWorkspace = ({ world, onEdit }: FileWorkspaceProps): ReactElement => {
  const files = ConfigurationFiles.filesOf(world);
  const [name, setName] = useState(Object.keys(files)[0] ?? "main.tf");
  const [content, setContent] = useState(files[name] ?? "");
  const [example, setExample] = useState("terraform-network");
  const [overwrite, setOverwrite] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const savedContent = files[name];
  useEffect(() => {
    if (savedContent !== undefined) {
      setContent(savedContent);
    }
  }, [savedContent]);

  const edit = (action: FileEdit): boolean => {
    const result = onEdit(action);
    if (!result.ok) {
      setError(result.error);
      setNotice("");
      return false;
    }
    setError("");
    setNotice("保存しました。");
    return true;
  };

  return (
    <section aria-label="設定ファイル" className="space-y-4 p-4">
      <p className="text-sm text-muted">
        設定ファイルを編集し、kubectl apply -f や terraform plan から使用できます。
      </p>
      <div className="space-y-2 rounded border border-line p-3">
        <label className="block text-sm">
          テンプレート
          <select
            aria-label="ファイルテンプレート"
            className={field}
            value={example}
            onChange={(event) => setExample(event.target.value)}
          >
            {Object.keys(ConfigurationFiles.examples).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(event) => setOverwrite(event.target.checked)}
          />
          同名のファイルを置き換える
        </label>
        <SecondaryButton
          onClick={() => {
            if (edit({ kind: "load", name: example, overwrite })) {
              const first = Object.keys(ConfigurationFiles.examples[example] ?? {})[0];
              if (first) {
                setName(first);
                setContent(ConfigurationFiles.examples[example]?.[first] ?? "");
              }
            }
          }}
        >
          テンプレートを読み込む
        </SecondaryButton>
      </div>
      <label className="block text-sm">
        ファイルを開く
        <select
          aria-label="設定ファイルを選択"
          className={field}
          value={Object.hasOwn(files, name) ? name : ""}
          onChange={(event) => {
            setName(event.target.value);
            setContent(files[event.target.value] ?? "");
            setError("");
            setNotice("");
          }}
        >
          <option value="">新規ファイル</option>
          {Object.keys(files).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        ファイル名
        <input
          aria-label="設定ファイル名"
          className={`${field} font-mono`}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="block text-sm">
        内容
        <textarea
          aria-label="設定ファイルの内容"
          className={`${field} min-h-72 font-mono`}
          spellCheck={false}
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <PrimaryButton onClick={() => edit({ kind: "write", name, content })}>
          ファイルを保存
        </PrimaryButton>
        <SecondaryButton
          disabled={!Object.hasOwn(files, name)}
          onClick={() => {
            if (edit({ kind: "delete", name })) {
              setContent("");
              setNotice("削除しました。リソースは変更していません。");
            }
          }}
        >
          ファイルを削除
        </SecondaryButton>
      </div>
      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-ok-ink text-sm">
          {notice}
        </p>
      )}
    </section>
  );
};
