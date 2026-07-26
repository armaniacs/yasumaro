# PBI: Obsidian Local REST APIのエンドポイントをクライアント内で抽象化する

**作成日**: 2026-07-25
**完了日**: 2026-07-26
**優先度**: Low
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（内部実装のリファクタリングだが、既存の全Obsidian連携機能に影響する範囲のため回帰テストを丁寧に行う必要がある）

## 実装メモ（2026-07-26）

`obsidianClient.ts` に `ENDPOINTS` オブジェクト（`root()`, `dailyNote()`）を新設し、`appendToDailyNote()` と
`testConnection()` 内のパス組み立てをこの2関数経由に統一した。`127.0.0.1` のハードコード（4箇所）も
`DEFAULT_HOST` 定数に集約。

回帰確認の過程で、`obsidianClient.test.ts` のモック規約（`storage.StorageKeys` を大文字キー名の文字列に
オーバーライドする、`obsidianClient-mutex.test.ts` と同じパターン）を誤解し、一度小文字スネークケースの
キー名でテストを書いてしまった。実際に生成されるURLで検証し直し、正しいモック規約に沿って修正した
（`buildDailyNotePath` もこのテストファイルでは固定文字列 `'2026-02-07'` を返すモックになっている点も
考慮）。

新規に2件のURL検証テスト（`ENDPOINTS.dailyNote()`のvaultパス生成、`ENDPOINTS.root()`のルートURL）を追加。
obsidianClient全70件パス。

---

## 背景

Checking Team レビュー（2026-07-25）の API & Contract Negotiator からの指摘。`src/background/obsidianClient.ts:108`（`baseUrl`組み立て）、`:153/157/162`（`127.0.0.1`ハードコード）、`:217`（`${baseUrl}/vault/${pathSegment}...`）など、エンドポイントパス文字列がクライアントコード内に直書きされている。Obsidian Local REST APIの仕様変更時に複数箇所を直接修正する必要がある密結合構造。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "baseUrl\|127.0.0.1\|/vault/" src/background/obsidianClient.ts
```

このPBIは PBI-09（APIエンドポイントドキュメント化）の後、またはそれと並行して行うと効率的（ドキュメント化の過程でエンドポイント一覧が明確になるため）。過度な抽象化（DIコンテナ等）は避け、パス文字列の一元管理程度に留める。

## 受け入れ基準（BDD）

```gherkin
Scenario: エンドポイントパスが一箇所で定義される
  Given obsidianClient.ts 内に ENDPOINTS のようなパス定義オブジェクトがある
  When 開発者が /vault/ エンドポイントのパスを変更する必要がある
  Then 1箇所の変更で全ての呼び出し箇所に反映される

Scenario: 既存のAPI呼び出しの挙動が変わらない
  Given リファクタリング後のobsidianClient.ts
  When 既存のObsidian連携テストを実行する
  Then 全てパスする（実際に呼び出されるURLが変化しない）
```

## 受け入れ基準
- [ ] `obsidianClient.ts` 内のエンドポイントパスを `ENDPOINTS` オブジェクト（またはパスビルダー関数群）として一元化する
- [ ] `127.0.0.1` のハードコードを設定値経由に統一する（既にホスト設定可能であれば、パス生成ロジックのみ整理する）
- [ ] 既存の `obsidianClient` テストが全てパスする
- [ ] 実際に呼び出されるURLがリファクタリング前後で一致することを確認する

## テスト戦略（t_wadaスタイル）

### 単体テスト
- 各エンドポイントビルダー関数が正しいURLを生成することを確認するテストを追加
- 既存の `obsidianClient.test.ts` が回帰しないことを確認

### 統合テスト
- モックサーバーへの実際のリクエストURLがリファクタリング前後で一致することを確認

## 実装アプローチ

1. `obsidianClient.ts` 内の全fetch呼び出しからエンドポイントパスを洗い出す（PBI-09の調査結果を再利用可能）
2. パスビルダー関数またはテンプレートオブジェクトとして一元化
3. 各呼び出し箇所を新しいビルダー経由に置き換え
4. テストでURL生成結果が変わらないことを確認

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: PBI-09（APIエンドポイントドキュメント化）と関連
- テスタビリティ: 既存の `obsidianClient` テストが土台

## Definition of Done
- [ ] エンドポイントパスが一元管理されている
- [ ] 既存テストが全てパスする
- [ ] URL生成結果の一致がテストで確認されている
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（API & Contract Negotiator指摘、「Obsidian Local REST APIの疎結合」Low項目と統合）
- 対象コード: `src/background/obsidianClient.ts:108, 153, 157, 162, 217`
- 関連PBI: `2026-07-25-09-doc-api-endpoint-documentation.md`
