# PBI: trim 連鎖 idiom の getValue 統一

## ユーザーストーリー
開発者として、`url?.value.trim() ?? ''` の残存形を `getValue` に統一したい。なぜなら、`getValue` 導入後に等価な別形が並立しており、将来の修正で片方だけ直す乖離リスクがあるから

## ビジネス価値
- 値抽出 idiom の一本化により、修正漏れリスクを低減
- PBI 05 の残件を閉じ、DRY バッチを完成させる

## BDD受け入れシナリオ

```gherkin
Scenario: trim 付き URL 取得が統一後も正しく動く
  Given 空白付き URL が入力されている
  When   保存処理で値を読み取る
  Then   trim 済みの値が設定に保存される（従来と同一）

Scenario: 要素欠落時も従来どおりフォールバックする
  Given URL 要素が DOM に存在しない
  When   保存処理で値を読み取る
  Then   空文字列が使われ、例外が発生しない
```

## 受け入れ基準
- [x] `src/dashboard/webhookExportSettings.ts:220` の `url?.value.trim() ?? ''` を `getValue(url).trim()` に置換した（等価性: null→`''`、存在時→`value.trim()` の両分岐で同一。/tmp/whywhy-trim-unification.md に記録）
- [x] `npm run type-check` が pass する
- [x] `webhookExportSettings-seam.test.ts` がすべて pass する（4件）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし（1行置換）

### 統合テスト
- seam テストの save 経路（空白付き URL の保存確認があればそれで担保）

### 単体テスト
- 既存 seam テストでカバー（新規テスト不要。等価置換のため）

比率: E2E:統合:単体 = 0:1:0

## 実装アプローチ
- **Outside-In**: 既存 seam テストの緑を確認 → 1行置換 → グリーン再確認
- **Red-Green-Refactor**: 等価置換のため赤フェーズなし。置換前後でテスト緑を比較する

## 見積もり
1 ストーリーポイント未満の小規模（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし（PBI 05 の `getValue` を再利用）
- テスタビリティ: 既存 seam テストで担保
- 非機能要件: なし

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
# 残存箇所の確認
grep -n "value.trim() ??" src/dashboard/webhookExportSettings.ts
```

確認済み（2026-11-22）: 220行目の1件のみ。PBI 05 で明示的に対象外とした形状であり、等価性は `null → ''` と `value.trim()` の両分岐で成立することを確認済み。

### 実装手順
1. 220行目を `getValue(url).trim()` に置換する（`getChecked` と同ファイルで import 済みの `getValue` を追加 import する必要あり）
2. `npm run type-check` と seam テストの緑を確認する

### 落とし穴
- `getValue` の import 追加を忘れないこと（現行は `getChecked` のみ import）
- 空白のみの入力（`'   '` → `''`）の挙動が変わらないこと（trim のため同一）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（既存 seam 4件が置換後も緑。欠落 DOM 許容テストを含む）
- [x] テストカバレッジが基準を満たす（1行の等価置換。分岐の増減なし）
- [ ] コードレビュー完了（GitHub PR での approve を必須とする。セキュリティに関わる変更は CLAUDE.md「For Security Review Agents」節の観点確認をPR説明に明記）
- [x] リファクタリング完了（グリーン後。等価置換のため追加の磨き込みなし）
- [x] ロールバック手段の検討（1行の等価置換のため切り戻しは revert のみで足りる）
- [x] ドキュメント更新済み（公開 API・仕様の変更なし。PBI 自体に方式と証跡を記録）
