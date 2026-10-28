import type { Mission } from "@/engine/missions";
import { MissionStep, type StepDetail } from "@/engine/missions/mission-step";
import { Option } from "@/utils/Option";

const value = "(?:'([^']*)'|\"([^\"]*)\"|([^\\s→。、]+))";
const readFiles = /sim files read ([\w./-]+)/g;
const loadFiles = /sim files load ([\w-]+)( --force)?/g;
const writeFiles = new RegExp(`sim files write ([\\w./-]+) --content=${value}`, "g");
const replaceFiles = new RegExp(
  `sim files replace ([\\w./-]+) --search=${value} --replacement=${value}`,
  "g",
);

const fileInstructions = (source: string): string =>
  source
    .replace(/sim terraform backend、?\s*/g, "")
    .replace(
      loadFiles,
      (_, name: string, force: string) =>
        `ファイル画面で「${name}」のテンプレートを読み込む${force ? "（同名ファイルを置き換える）" : ""}`,
    )
    .replace(readFiles, (_, name: string) => `ファイル画面で「${name}」を開く`)
    .replace(
      writeFiles,
      (_, name: string, quoted: string, double: string, plain: string) =>
        `ファイル画面で「${name}」に次の内容を保存: ${quoted ?? double ?? plain}`,
    )
    .replace(
      replaceFiles,
      (_, name: string, a: string, b: string, c: string, d: string, e: string, f: string) =>
        `ファイル画面で「${name}」の「${a ?? b ?? c}」を「${d ?? e ?? f}」に書き換えて保存`,
    )
    .replace(/sim files readで/g, "ファイル画面で")
    .replace(/sim files(?:で|は)/g, "ファイル画面で")
    .replace(/sim files/g, "ファイル画面")
    .replace(/--force/g, "「同名のファイルを置き換える」")
    .replace(/を読み込む で/g, "を読み込んで")
    .replace(/を開く\s*で/g, "を開いて");

const writeLine = new RegExp(`^sim files write ([\\w./-]+) --content=${value}$`);

/** `sim files …` の行はファイル画面の操作に、それ以外は端末の行のまま見せる。 */
const publicDetail = (detail: StepDetail): StepDetail => {
  if (detail.kind !== "cli" || !detail.line.startsWith("sim files ")) return detail;
  const write = writeLine.exec(detail.line);
  if (write) {
    const [, name, quoted, double, plain] = write;
    return { kind: "file", name: name ?? "", content: quoted ?? double ?? plain ?? "" };
  }
  return { kind: "action", text: fileInstructions(detail.line) };
};

const publicStep = (step: MissionStep): MissionStep => ({
  what: fileInstructions(step.what),
  detail: Option.map(step.detail, publicDetail),
  note: Option.map(step.note, fileInstructions),
});

/** 実在するCLIと通常の設定ファイル編集だけで達成できる演習を公開する。 */
export const practiceCatalog = (definitions: readonly Mission[]): readonly Mission[] =>
  definitions.flatMap((mission) => {
    // サーバーレス教材は本物に無いフラグ（`functions call --anonymous` など）や `sim events` を使うので、
    // 手順の文面に `sim` が残っていなくても公開しない。
    const hidden = ["aceDecision", "aiLesson", "serverlessLesson"];
    if (mission.assertions.some((a) => hidden.includes(a.kind))) {
      return [];
    }
    const description = fileInstructions(mission.description);
    const steps = mission.steps.map(publicStep);
    if ([description, ...steps.map(MissionStep.text)].some((text) => /\bsim\s/.test(text))) {
      return [];
    }
    return [{ ...mission, description, steps }];
  });
