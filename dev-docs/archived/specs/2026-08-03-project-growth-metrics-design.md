# プロジェクト成長メトリクス履歴 設計仕様

## 背景・目的

このプロジェクト（Yasumaro）は v2.0.0 から現在の v6.7.9 まで84個のタグを重ねてきた。バージョン番号・行数・テスト数・ファンクション数などの推移を記録し、後日「プロジェクトの歴史を振り返る記事」を書けるようにするためのデータを残す。

GitHub release のタイミングでメトリクスを自動計測し、リポジトリ内に履歴として蓄積する仕組みを構築する。あわせて、過去の主要マイルストーンタグについても遡ってメトリクスを計測し、初期データとして投入する。

## スコープ

- 対象: このリポジトリ（obsidian-smart-history / Yasumaro）のコードメトリクス履歴
- 含む: 静的解析によるメトリクス計測スクリプト、release.yml への組み込み、過去マイルストーンのbackfill
- 含まない: メトリクスの可視化・グラフ化・記事執筆そのもの（将来の別タスク）

## メトリクス項目

各バージョンについて以下を記録する。

| フィールド | 内容 | 取得方法 |
|-----------|------|---------|
| `version` | package.json のバージョン番号 | 対象refの package.json から抽出 |
| `tag` | git タグ名 | 引数として渡す |
| `date` | タグが打たれた日時（ISO 8601） | `git log -1 --format=%aI <tag>` |
| `linesOfCode` | `src/` `entrypoints/` 配下の `.ts`/`.tsx`/`.js` 総行数 | 対象ファイルの行数を合算 |
| `fileCount` | 上記対象ファイル数 | ファイル一覧のカウント |
| `testCount` | `.test.ts`/`.spec.ts` 内の `it(`/`test(` 呼び出し数 | 正規表現カウント |
| `functionCount` | 関数・メソッド定義のおおよその数 | 正規表現カウント（`function `, アロー関数、メソッド定義） |
| `dependencyCount` | `dependencies` + `devDependencies` の数 | package.json をパース |

**注記**: `functionCount` と `testCount` は正規表現ベースの近似値であり、AST解析による厳密な値ではない。目的は「経年比較のトレンドを見る」ことであり、単一バージョンの絶対値の厳密性は求めない。

## 計測方式: 静的解析のみ（checkout不要）

過去の古いタグ（v2.0.0 等）は現在と大きく異なる npm 環境・依存構成を持ち、`npm ci` や `npm test` を実行すると高い確率で失敗する。そのため、実行型の計測（実際にビルド・テストを走らせる）は採用しない。

代わりに `git ls-tree` と `git show <ref>:<path>` を使い、対象タグのファイル内容をワーキングツリーに反映せず直接読み出して解析する。これにより：

- 現在のワーキングツリーを一切汚さない
- 依存関係のインストールが不要で高速
- 過去・現在で同一ロジックを使うため、時系列比較の一貫性が保たれる

今後のリリース（release.yml 内、npm ci 済みの環境）でも、時系列比較の一貫性を優先し、あえて実行型を使わず同じ静的解析ロジックで統一する。

## データ保存形式

`dev-docs/metrics/history.json` にJSON配列として蓄積する。追記式（既存レコードは変更せず、新しいレコードを追加）。

```json
{
  "records": [
    {
      "version": "2.0.0",
      "tag": "v2.0.0",
      "date": "2025-01-15T00:00:00+09:00",
      "linesOfCode": 1234,
      "fileCount": 12,
      "testCount": 5,
      "functionCount": 80,
      "dependencyCount": 10
    },
    {
      "version": "6.7.9",
      "tag": "v6.7.9",
      "date": "2026-07-20T12:00:00+09:00",
      "linesOfCode": 45230,
      "fileCount": 312,
      "testCount": 1105,
      "functionCount": 2840,
      "dependencyCount": 38
    }
  ]
}
```

同一 `tag` のレコードが既に存在する場合は上書き（再実行時の冪等性を確保）。配列は `date` 昇順でソートして保存する。

## コンポーネント構成

### `scripts/metrics/collect.mjs`

- 引数: git ref（タグ名、例 `v6.7.9`）
- 処理: 該当refのファイルを `git show`/`git ls-tree` で読み出し、メトリクスを計測して1レコード分のJSONオブジェクトを標準出力に返す
- 単体で `node scripts/metrics/collect.mjs v6.7.9` のように実行可能

### `scripts/metrics/updateHistory.mjs`

- 引数: git ref
- 処理: `collect.mjs` のロジックを呼び出し、結果を `dev-docs/metrics/history.json` に追記（同一tagは上書き）、日付順にソートして書き戻す
- release.yml から呼ばれるエントリポイント

### `scripts/metrics/backfill.mjs`

- 処理: 主要マイルストーンタグのリストをループし、各タグに対して `updateHistory.mjs`相当の処理を実行
- 対象タグ（マイナー系列の先頭、18個）:
  `v2.0.0, v2.1.0, v2.2.0, v2.3.0, v3.0.0, v4.0.0, v4.1, v4.2.0, v5.0.0, v5.1.0, v5.2.0, v6.0.1, v6.1.2, v6.3.0, v6.4.0, v6.5.2, v6.6.0, v6.7.2`
- 一度きりの実行を想定するが、再実行しても冪等（上書きされるだけ）

### package.json への npm script 追加

```json
"metrics:collect": "node scripts/metrics/updateHistory.mjs",
"metrics:backfill": "node scripts/metrics/backfill.mjs"
```

## release.yml への組み込み

`.github/workflows/release.yml` の `Create Release` ステップの後に以下を追加する。

```yaml
- name: Record project metrics
  run: node scripts/metrics/updateHistory.mjs ${{ github.ref_name }}

- name: Commit metrics history
  run: |
    git config user.name "github-actions[bot]"
    git config user.email "github-actions[bot]@users.noreply.github.com"
    git add dev-docs/metrics/history.json
    git commit -m "chore(metrics): record ${{ github.ref_name }} growth metrics" || echo "No changes to commit"
    git push origin HEAD:main
```

release ジョブは `contents: write` 権限を既に持っているため追加の権限設定は不要。タグpushトリガーだが、pushはブランチ `main` に対して行う。

## 初期データ投入（backfill）

設計承認・実装完了後、この作業の中で `npm run metrics:backfill` をローカルで実行し、18タグ分のレコードを `dev-docs/metrics/history.json` に書き込んでコミットする。

## エラーハンドリング

- 対象タグの `package.json` が存在しない、またはパース不能な場合はそのタグをスキップし、警告をログ出力する（v2.0.0系で構成が異なる可能性があるため）
- `git show` が失敗するパス（該当ファイルがそのタグ時点で存在しない）は該当ファイルを除外してカウントを続行する

## テスト方針

- `collect.mjs` の正規表現ベースのカウントロジックに対し、固定のサンプル文字列を使った単体テストを `scripts/metrics/__tests__/collect.test.ts` に追加する
- 実際のgitリポジトリ操作（`git show`/`git ls-tree`）はモックせず、現在のリポジトリ自身に対して `node scripts/metrics/collect.mjs HEAD` を実行し、エラーなく妥当な範囲の値が返ることを確認する統合的なチェックを1つ用意する

## 検証方法

1. `node scripts/metrics/collect.mjs v6.7.9` を実行し、妥当なメトリクス値が返ることを確認
2. `npm run metrics:backfill` を実行し、`dev-docs/metrics/history.json` に18件のレコードが日付順で書き込まれることを確認
3. `npm run type-check` / `npm test` で既存テストに影響がないことを確認
4. release.yml の変更はGitHub Actions上の実行を待たず、ローカルでシェル部分のロジック（コミットメッセージ生成、git操作）を目視レビューする
