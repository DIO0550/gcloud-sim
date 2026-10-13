import { TerraformExamples } from "@/engine/commands/terraform/examples";
import { KubeManifest, KubeManifestExamples } from "@/engine/domains/kube-manifest";
import { TfStructure } from "@/engine/domains/terraform/structure";
import { World } from "@/engine/domains/world";
import { Result } from "@/utils/Result";

export type FileEdit =
  | Readonly<{ kind: "write"; name: string; content: string }>
  | Readonly<{ kind: "delete"; name: string }>
  | Readonly<{ kind: "load"; name: string; overwrite: boolean }>;
const examples = { ...TerraformExamples, ...KubeManifestExamples };
const filesOf = (world: World): Readonly<Record<string, string>> => ({
  ...world.terraform.files,
  ...world.kubeFiles,
});
const validName = (name: string): boolean =>
  TfStructure.filePath(name) || KubeManifest.path(name) === name;

const withFiles = (
  world: World,
  files: Readonly<Record<string, string>>,
): Result<World, string> => {
  if (Object.keys(files).some((name) => !validName(name))) {
    return Result.err("相対パスの.tf・.tfvars・.yaml・.yml・.jsonを指定してください。");
  }
  if (Object.values(files).some((content) => content.length > 64000)) {
    return Result.err("1ファイルは64,000文字までです。");
  }
  const kubeFiles = Object.fromEntries(
    Object.entries(files).filter(([name]) => KubeManifest.path(name)),
  );
  const terraformFiles = Object.fromEntries(
    Object.entries(files).filter(([name]) => TfStructure.filePath(name)),
  );
  if (Object.keys(kubeFiles).length > 32 || Object.keys(terraformFiles).length > 32) {
    return Result.err("各作業領域のファイルは32個までです。");
  }
  return World.validate({
    ...world,
    kubeFiles,
    terraform: { ...world.terraform, files: terraformFiles },
  });
};

/** 通常の設定ファイル編集。CLIを生成・実行せず、保存済みリソースも変更しない。 */
export const ConfigurationFiles = {
  examples,
  filesOf,
  edit(world: World, edit: FileEdit): Result<World, string> {
    const files = filesOf(world);
    if (edit.kind === "load") {
      const example = Object.hasOwn(examples, edit.name) ? examples[edit.name] : undefined;
      if (!example) {
        return Result.err("テンプレートが見つかりません。");
      }
      if (Object.keys(example).some((name) => Object.hasOwn(world.terraform.plans, name))) {
        return Result.err("保存済みplanと同じ名前のファイルは作成できません。");
      }
      if (!edit.overwrite && Object.keys(example).some((name) => Object.hasOwn(files, name))) {
        return Result.err("同名のファイルがあります。内容を確認してから置き換えてください。");
      }
      return withFiles(world, { ...files, ...example });
    }
    if (!validName(edit.name)) {
      return Result.err("相対パスの設定ファイル名を指定してください。");
    }
    if (Object.hasOwn(world.terraform.plans, edit.name)) {
      return Result.err("保存済みplanと同じ名前のファイルは変更できません。");
    }
    if (edit.kind === "write") {
      return withFiles(world, { ...files, [edit.name]: edit.content });
    }
    if (!Object.hasOwn(files, edit.name)) {
      return Result.err("ファイルが見つかりません。");
    }
    return withFiles(
      world,
      Object.fromEntries(Object.entries(files).filter(([name]) => name !== edit.name)),
    );
  },
} as const;
