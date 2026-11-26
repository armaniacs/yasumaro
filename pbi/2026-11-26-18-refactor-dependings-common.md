# PBI: dependings スクリプトの共通化と「最終確認日」の再スタンプ制御

## ユーザーストーリー
保守担当者として、dependings スクリプト (generate / check) の共通知識を 1 つのモジュールに集約し、generate が「最終確認日」を無条件に今日へ書き換えないようにしたい、なぜなら行テンプレート / parse 正規表現 / エイリアス map が generate と check に二重実装されており (Maintainability 指摘)、generate が確認なしで日付を進めると鮮度ゲート (check) の信頼性を損なう (Supply Chain 指摘) から。

## ユーザーへの背景
- 現状: scripts/generate-dependings.mjs (155 行) と scripts/release-checks/check-dependings.mjs (238 行) が、DEPENDINGS.md のセクションパース・行テンプレート・パッケージ数カウントをそれぞれ独立に保持
- generate の問題: `today()` を無条件に「最終確認日」へ書き込む (generate-dependings.mjs:27-30、55、67)。鮮度判定は git コミット日時ベースに変更済み (PBI 2026-11-26 dependings ラウンド) が、日付が進むだけで鮮度ゲートは黙って通る
- 既知 (d) の完全統一 (書式知識の全面共通化) は次ラウンド以降。本 PBI は「日付制御」と「重複の第一歩」を踏む

## ビジネス価値
- 鮮度ゲートが「実際に確認した日」を正しく反映する (generate の再スタンプによる黙って通過が消える)
- 測定方法: generate を既存 DEPENDINGS.md に対して実行しても「最終確認日」行が変わらないこと、明示フラグ (`--confirm-date`) でだけ進むこと

## BDD受け入れシナリオ

```gherkin
Scenario: 再スタンプは明示フラグでのみ起きる
  Given 最終確認日が 2026-11-20 の DEPENDINGS.md がある
  When generate-dependings を確認フラグなしで実行する
  Then 最終確認日は 2026-11-20 のまま (その他のセクションのみ更新される)

Scenario: 確認フラグで日付が進む
  Given 同じ DEPENDINGS.md がある
  When generate-dependings --confirm-date を実行する
  Then 最終確認日が今日に更新される
```

## 受け入れ基準
- [x] scripts/lib に dependingsCommon.mjs (または dependingsCommon.js) を新設し、generate と check が重複していた共通知識 (DEPENDINGS_PATH 等のパス、セクション判定正規表現、パッケージ数カウント、日付ユーティリティ) を抽出している
- [x] generate-dependings.mjs が「最終確認日」行を既存値に保持し、`--confirm-date` (明示フラグ) のときだけ今日に更新する
- [x] check-dependings.mjs の鮮度判定は無変更 (git コミット日時ベースの現状を維持)
- [x] scripts/__tests__/ の既存 dependings 試験が緑、generate の新挙動試験 (フラグなし= 保持、フラグ付き= 進む) が追加されている
- [x] gen-oxlintrc-ssot.test.ts 等の他スクリプト試験が壊れない
- [x] `npm run validate` が通る

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし (スクリプトのため統合試験で裏取り)

### 統合テスト
- generate → check の往復 (フラグなし generate は鮮度ゲートを黙って通さない)

### 単体テスト
- dependingsCommon.mjs の純粋関数 (パース、数え上げ)、generate の日付保持 / 進行

## 見積もり
S (3 SP、要チームでの見積もり)

## 技術的考慮事項
- 出所: Supply Chain & Dependency Sentinel 指摘 (holistic-1126 レビュー報告書)、Maintainability 指摘 (既知 (d) の第一歩)
- 挙動変更は意図的 (generate の日付再スタンプ停止)。使用ドキュメント (CONTRIBUTING.md 等) に generate の使い方が記載されている場合、--confirm-date の説明を追記する
- check-dependings.mjs の鮮度判定は PBI dependings ラウンドで git コミット日時ベースに変更済み (PBI 14 以前の dependings ラウンド)。本 PBI では触らない
- なぜなぜ分析: 日付再スタンプが放置された根本原因は、鮮度判定が mtime (checkout 順序依存) だった時代に「日付が変わってもゲートが flaky でしか落ちなかった」ため、日付の意味が検証されなかったこと

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
grep -n "today\|最終確認日\|dateAgeDays" scripts/generate-dependings.mjs | head -10
grep -n "dependingsCommon\|import" scripts/release-checks/check-dependings.mjs | head -10
ls scripts/lib 2>/dev/null || echo "no scripts/lib"
```

### 実装手順
1. dependingsCommon.mjs 新設 (パス、セクション判定、パッケージ数、日付ユーティリティ)
2. generate と check を common import に差し替え (byte-identical 出力の pin を先に作る)
3. generate の日付制御 (フラグなし= 保持、--confirm-date= 進む) を実装
4. 新挙動試験追加、既存試験の pin 更新 (理由を明記)

### 落とし穴
- generate の出力は byte-identical pin されている場合がある (scripts/__tests__/ 内の dependings 試験を先に確認する)
- `--confirm-date` の挙動変更はドキュメント (CONTRIBUTING.md / docs/DEPENDINGS.md 冒頭) に使われ方が書かれていないか確認して整合させる
- 鮮度ゲート (check) を壊さない (generate 直後に check を回して fresh であること。日付を保持すれば stale は出ない ― ただし元々 stale の場合はそのまま)
- git 操作禁止。実時間待ち禁止

## Definition of Done
- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす (統合/単体)
- [x] コードレビュー完了
- [x] リファクタリング完了 (グリーン後)
- [x] ドキュメント更新の要否判定: 使用方法の変化 (--confirm-date) があるため、該当 docs があれば更新 (なければ本 PBI 内で使用方法をスクリプトヘッダに記載)
