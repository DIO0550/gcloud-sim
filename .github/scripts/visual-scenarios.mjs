/**
 * 撮影する画面の一覧。
 *
 * 見た目の差分（VRT）は、ここに並べた「画面 × 幅」の枚数だけ撮る。画面を足したいときは
 * SCENARIOS に 1 つ足すだけでよく、ワークフロー側は触らない。
 *
 * 撮影を安定させるために 2 つ仕込んである。
 * - 時刻を固定する（capture 側で Date を差し替える）。実時刻から作る表示が撮るたびに
 *   変わると、毎回差分として出てしまうため
 * - 撮る前に localStorage を空にし、storage に書いたものだけを置く。画面の操作で
 *   作ると時間がかかる状態は、ここに直接置く
 */

/**
 * 撮影する幅。height は「この高さの画面で開いたとき」を表す。
 * 撮るのはページ全体だが、maxHeight までで切る（縦に長い画面を全部撮ると、
 * 1 枚が大きくなりすぎてレビューでも保存でも扱いにくいため）。
 */
export const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1600, maxHeight: 2000 },
  { name: "mobile", width: 430, height: 1200, maxHeight: 2600 },
];

/** 撮影時に固定する時刻。UTC でも JST でも同じ日付になる時刻を選んである。 */
export const FROZEN_TIME = Date.UTC(2026, 0, 1, 12, 0, 0);

/**
 * 画面ごとの手順。
 *
 * storage に { キー: 値 } を書くと、撮る前に localStorage へ JSON で置く。
 *
 * steps に書けるもの:
 * - { click: "ボタンの文字" }        文字がちょうど一致するボタンを押す
 * - { wait: 400 }                    ミリ秒待つ
 */
export const SCENARIOS = [
  {
    name: "home",
    label: "トップ",
    steps: [],
  },
];
