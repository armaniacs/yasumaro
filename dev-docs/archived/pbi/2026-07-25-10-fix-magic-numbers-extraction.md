# PBI: background/ 配下の散在するマジックナンバーを定数化する

**作成日**: 2026-07-25
**優先度**: Low
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（値は変更せず名前を付けるのみ）

---

## 背景

Checking Team レビュー（2026-07-25）の Maintainability Guardian からの指摘。`src/background/manualContentFetcher.ts:109`（`setTimeout(resolve, 10000)`）、`src/background/sessionAlarmsManager.ts:142`（`setTimeout(resolve, 100)`）、`src/background/sqliteClient.ts` のタイムアウト値、`src/background/recordingLogic.ts:175`（`< 30000` キャッシュ有効期限）など、意味を持つ数値がリテラルのまま埋め込まれている。値の意味がコードを読むだけでは分からず、変更時に影響範囲を見誤るリスクがある。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "setTimeout(resolve, [0-9]" src/background/*.ts
grep -n "< 30000\|30000\|10000" src/background/recordingLogic.ts src/background/manualContentFetcher.ts src/background/sessionAlarmsManager.ts src/background/sqliteClient.ts
```

値そのものを変更するタスクではなく、named constant に抽出するリファクタリングであることに注意。挙動を変えないこと。

## 受け入れ基準（BDD）

```gherkin
Scenario: タイムアウト値が名前付き定数として定義されている
  Given manualContentFetcher.ts に FETCH_TIMEOUT_MS のような定数がある
  When コードを読む開発者がこの値を見る
  Then コメントなしでも用途が分かる

Scenario: 既存の挙動が変わらない
  Given 定数抽出のリファクタリングを適用した状態
  When 既存のユニットテストを実行する
  Then 全てパスする（タイムアウト時間・キャッシュ有効期限の実際の値は変化しない）
```

## 受け入れ基準
- [ ] `manualContentFetcher.ts` の `10000` を `FETCH_TIMEOUT_MS` 等の名前付き定数に抽出する
- [ ] `sessionAlarmsManager.ts` の `100` を意味の分かる定数名に抽出する
- [ ] `recordingLogic.ts` の `30000`（キャッシュ有効期限）を `CACHE_TTL_MS` 等に抽出する
- [ ] `sqliteClient.ts` 内のタイムアウト値も同様に抽出する
- [ ] 値そのものは変更しない（挙動を変えないリファクタリング）

## テスト戦略

### 単体テスト
- 各ファイルの既存テストがリファクタリング後も全てパスすることを確認
- 新規テストは不要（値を変えないため）

## 実装アプローチ

1. 対象ファイルの `setTimeout` / 比較式のリテラル数値を洗い出す
2. ファイル冒頭またはモジュールスコープに `const XXX_MS = N;` として定義
3. リテラル箇所を定数参照に置き換え

## 見積もり

1pt（機械的な置換、複数ファイルだが低リスク）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: 既存テストで担保

## Definition of Done
- [ ] 対象ファイルのマジックナンバーが定数化されている
- [ ] 既存テストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（Maintainability Guardian指摘）
- 対象コード: `src/background/manualContentFetcher.ts`, `src/background/sessionAlarmsManager.ts`, `src/background/recordingLogic.ts`, `src/background/sqliteClient.ts`
