/**
 * GitHub Pages のプロジェクトページは https://<user>.github.io/<repo>/ に出るので、
 * リポジトリ名の分だけパスが深くなる。next.config.ts と public/ 配下への参照の
 * 両方で使うため、ここを唯一の定義とする。
 * リポジトリをリネームしたり独自ドメインを当てたりしたら、この既定値を変える。
 *
 * PR プレビューは .../gcloud-sim/pr-preview/pr-<番号>/ に出すので、そのビルドのときだけ
 * NEXT_PUBLIC_BASE_PATH で上書きする（ビルド時に値が焼き込まれる。実行時には変えられない）。
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "/gcloud-sim";

/** public/ 配下のファイルを参照する URL を作る。path は先頭スラッシュ付き。 */
export const assetUrl = (path: string): string => `${BASE_PATH}${path}`;
