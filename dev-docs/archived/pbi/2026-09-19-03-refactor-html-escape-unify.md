# PBI: htmlEscape を正本に一本化する

## ユーザーストーリー
開発者として、HTMLエスケープ関数が一か所にまとまっていてほしい、なぜなら4か所の分散は誤選択によるXSS漏れの構造的原因だから

## 優先度
- 順位: 03 / 13
- RICEスコア: 40（Reach=10 / Impact=2 / Confidence=80% / Effort=0.4）
- 根拠: innerHTML 連鎖対策の前提。開発者向けだが全XSS対策の土台であり、工数が極小

## ビジネス価値
将来の esc 漏れ事故を構造的に防ぐ。新規画面追加時の関数選択ミスがなくなる

## BDD受け入れシナリオ

```gherkin
Scenario: どの画面からも正本のエスケープが使われる
  Given 開発者がエスケープ関数を import する
  When src/utils/htmlEscape.ts から import する
  Then 正しくエスケープされる
  And 他の互換層からも同じ結果が得られる

Scenario: 使い分け表がドキュメントにある
  Given 新規開発者がエスケープで迷う
  When AGENTS.md を読む
  Then 使い分け表が見つかる
```

## 受け入れ基準
- [x] src/utils/htmlEscape.ts が正本として明示されている（正本コメント追加）
- [x] domUtils・errorUtils は既に再export の互換層であることを確認。markdownSanitizer は別責務（Markdownリンク処理）のため対象外と明記
- [x] 既存の呼び出し側の挙動が変わらない（type-check green）
- [x] AGENTS.md に使い分け表が追記されている

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 不要（内部リファクタリングのため）

### 統合テスト
- 各互換層経由のエスケープ結果が正本と一致する

### 単体テスト
- 正本のエスケープ関数の境界値（特殊文字・空文字・null）

## 実装アプローチ
- **Outside-In**: 互換層の一致テストから開始
- **Red-Green-Refactor**: 振る舞いを変えずに集約する

## 見積もり
1ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし（PBI 04・05 の前提になるが、本PBI単独で価値あり）
- テスタビリティ: 入出力比較テストが容易
- 非機能要件: 公開APIの変更なし

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "escapeHtml\|sanitizeForObsidian" src/utils/htmlEscape.ts src/utils/markdownSanitizer.ts src/popup/domUtils.ts src/popup/errorUtils.ts
```

### 実装手順
1. 正本と各分散関数の入出力一致テストを書く
2. 分散側を再export の互換層に置き換える
3. AGENTS.md に使い分け表を追記する

### 落とし穴
- 呼び出し側の import パスを一斉変更しないこと（互換層を残す）。段階移行が目的

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
