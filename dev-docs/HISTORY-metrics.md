# プロジェクト成長メトリクス履歴

`dev-docs/metrics/history.json` に蓄積している、バージョンごとのコードメトリクス履歴についてのガイドです。行数・テスト数・ファイル数などの推移を記録し、プロジェクトの成長を振り返るための一次データとして使います。

設計の背景は [docs/superpowers/specs/2026-08-03-project-growth-metrics-design.md](../docs/superpowers/specs/2026-08-03-project-growth-metrics-design.md) を参照してください。

## 何のためのデータか

- バージョン番号・行数・テスト数・ファンクション数などの推移を、gitタグ単位で記録する
- GitHub Releaseのタイミングで自動的に1件ずつ追記される
- 将来「プロジェクトの歴史を振り返る記事」を書く際の元データとして使う

## history.json のスキーマ

```json
{
  "records": [
    {
      "version": "2.1.1",
      "tag": "v2.2.0",
      "tagVersion": "2.2.0",
      "date": "2026-01-24T13:23:39+09:00",
      "linesOfCode": 3922,
      "fileCount": 24,
      "testCount": 61,
      "functionCount": 64,
      "dependencyCount": 3
    }
  ]
}
```

| フィールド | 内容 | 補足 |
|-----------|------|------|
| `version` | そのタグ時点の `package.json` の `version` | タグ名とバージョン番号がずれている場合、タグ名側と一致しないことがある（例: `v4.0.0` タグ時点の `package.json` は `3.9.7`） |
| `tagVersion` | タグ名から先頭の `v` を除いた値 | プロットの際はこちらを使うと、タグ名との対応が取れて信頼できる |
| `tag` | gitタグ名（例: `v6.7.9`） | 一意キー。同じ `tag` のレコードは上書きされ、重複しない |
| `date` | タグが指すコミットの author date（ISO 8601） | 軽量タグ・注釈付きタグどちらでも `git log -1 --format=%aI <tag>` の値 |
| `linesOfCode` | `src/`・`entrypoints/` 配下の `.ts`/`.tsx`/`.js` の総行数 | 単純合計。コメント行も含む |
| `fileCount` | 上記対象の総ファイル数 | `.test.ts`/`.spec.ts` も含む |
| `testCount` | `.test.ts`/`.spec.ts` 内の `it(`/`test(`（`it.each(...)` 等のチェイン呼び出しも含む）の呼び出し数の合計 | 正規表現ベースの近似値 |
| `functionCount` | 関数・アロー関数定義のおおよその数 | 正規表現ベースの近似値。クラスメソッド定義は現状カウント対象外 |
| `dependencyCount` | そのタグ時点の `package.json` の `dependencies` + `devDependencies` の数 | |

**注意**: `testCount` と `functionCount` は正規表現による近似値であり、AST解析による厳密な値ではありません。同一バージョン内の絶対値の精度よりも、バージョン間の推移（トレンド）を見る用途を優先した設計です。

レコードは `date` の昇順でソートされて保存されます。

## データの作り方

### 計測方法（静的解析、checkout不要）

`scripts/metrics/collect.mjs` が `git ls-tree`・`git show <ref>:<path>` を使い、指定したgit ref（タグ名）のファイル内容を直接読み出して解析します。**現在のワーキングツリーをcheckoutしない**ため、実行中に `npm run build:watch` 等が動いていても影響しません。

依存関係のインストールも不要（Node.js組み込みモジュールのみで動作）なので、古いタグに対しても高速かつ安全に実行できます。

### 手動で1タグ分を記録する

```bash
npm run metrics:collect -- <タグ名>
# 例:
npm run metrics:collect -- v6.5.15
```

`dev-docs/metrics/history.json` に該当タグのレコードが追記されます（既に同じ `tag` のレコードがあれば上書き）。実行後は差分を確認してコミットしてください。

```bash
git add dev-docs/metrics/history.json
git commit -m "chore(metrics): vX.Y.Zのメトリクスを記録"
```

### 複数タグをまとめて記録する（backfill）

```bash
npm run metrics:backfill
```

`scripts/metrics/backfill.mjs` の `MILESTONE_TAGS` に列挙されたタグ（現在は各マイナー系列の最初のタグ、計18個）を順番に処理します。失敗したタグがあってもスキップして処理を継続し、最後にまとめて失敗一覧を報告します（存在しないタグや、`package.json` 自体が存在しない古いタグなど）。

現在 `v2.0.0` と `v2.1.0` はこの仕組みでは記録されません。npm化（`package.json` の追加）は `v2.2.0` からのため、この2タグには計測対象のファイルが存在しないからです。これは既知の欠損であり、バグではありません。

### リリース時の自動記録

`.github/workflows/release.yml` に `record-metrics` ジョブがあり、タグをpushしてリリースが作られるたびに自動的にそのタグのメトリクスを計測し、`main` にコミット・pushします。

- `release`（ビルド・GitHub Release作成・Chrome Web Store公開）とは別ジョブとして独立している。Chrome Web Store公開のポーリングが長引いても、メトリクス記録がタイムアウトに巻き込まれることはない
- `needs: release` + `if: always()` により、`release` ジョブが失敗・タイムアウトしてもメトリクス記録は実行される（メトリクス収集自体はタグの内容を読むだけで、ビルド成果物に依存しないため）
- `continue-on-error: true` が設定されており、メトリクス記録が失敗してもワークフロー全体は失敗扱いにならない
- 手動での対応は基本的に不要。失敗した場合は「手動で1タグ分を記録する」の手順で後から追記できる

## 活用方法

### 振り返り記事のためのデータ抽出

`records` 配列をそのままグラフや表の元データとして使えます。

```bash
# jqで特定フィールドだけ抽出する例
jq '.records[] | {tag, tagVersion, linesOfCode, testCount}' dev-docs/metrics/history.json
```

- `date` を横軸、`linesOfCode`/`testCount`/`fileCount` を縦軸にすればプロジェクトの成長曲線が描ける
- `tagVersion` を使えばタグ名ベースで正確にバージョンを追える（`version` フィールドは `package.json` 由来のためタグ名とずれることがある点に注意）

### スキーマを変更する場合の注意

`testCount`・`functionCount` の計測ロジック（`scripts/metrics/collect.mjs` の正規表現）を将来変更する場合、既存レコードとの間で計測方法の断絶が生まれる点に注意してください。history.json自体には現状バージョン管理用のメタデータ（スキーマバージョン等）を持たせていないため、計測方法を変えた場合は変更履歴をこのドキュメントかコミットメッセージに残しておくことを推奨します。

## 関連ファイル

| ファイル | 役割 |
|---------|------|
| `scripts/metrics/collect.mjs` | 1タグ分のメトリクス計測ロジック（純粋関数 + gitラッパー） |
| `scripts/metrics/updateHistory.mjs` | history.jsonへの追記・ソート・書き戻し、CLIエントリポイント |
| `scripts/metrics/backfill.mjs` | 複数タグを一括処理するCLIスクリプト |
| `dev-docs/metrics/history.json` | メトリクス履歴データ本体 |
| `.github/workflows/release.yml` | `record-metrics` ジョブ（リリース時の自動記録） |
| `docs/superpowers/specs/2026-08-03-project-growth-metrics-design.md` | 設計仕様書 |
| `docs/superpowers/plans/2026-08-03-project-growth-metrics.md` | 実装計画 |
