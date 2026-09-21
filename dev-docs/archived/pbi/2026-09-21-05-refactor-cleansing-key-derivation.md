# PBI: クレンジングルール鍵の presets・restorable 列挙を CLEANSING_RULES から派生させる

## ユーザーストーリー
開発者として、クレンジングルールを追加したときに presets と restorable の列挙を手で追従させずに済ませたい、なぜなら CLEANSING_RULES が32行の SSOT であるにもかかわらず2箇所の手書き列挙が既に drift し、バックアップ復元で4フラグが黙って落ちる実害が発生しているから

## 優先度
- 順位: 4 / 5
- RICEスコア: 10.0（Reach=5 / Impact=3 / Confidence=100% / Effort=1.5週）
- 根拠: 本ラウンドで実害が既に発生している唯一の候補。Category B の4鍵が復元対象から漏れており、ルール追加のたびに3箇所の手書き同期が必要な状態が続いている

## ビジネス価値
ルール追加コストが「CLEANSING_RULES 1行 + presets 3箇所 + restorable 1箇所の手書き同期と目視確認」から「CLEANSING_RULES 1行」に減る。バックアップ復元での4フラグ欠落が解消され、preset 判定の取りこぼしが構造的に起きなくなる(locality)

## BDD受け入れシナリオ

```gherkin
Scenario: バックアップ復元で Category B の4フラグが復元される
  Given news_media / ec_site / qa_site / video_site を含むバックアップ payload
  When validateRestorableSettings で復元する
  Then 4鍵が sanitized に含まれ skippedKeys に含まれない

Scenario: ルール追加時に presets が追従する
  Given CLEANSING_RULES に新ルール1行を追加する
  When 派生後の PRESETS を読む
  Then minimal / balanced / aggressive のいずれにも新ルール鍵が存在し、isPresetMatch が新鍵を含めて判定する

Scenario: 派生鍵集合が SSOT と一致する
  Given 派生後の presets 鍵集合と restorable クレンジング boolean 鍵集合
  When CLEANSING_RULES の鍵集合と比較する
  Then 両集合とも過不足なく一致する(網羅性テストが green)

Scenario: 既存バックアップとの互換性が保たれる
  Given 4鍵を含まない旧形式バックアップ payload
  When validateRestorableSettings で復元する
  Then 欠落鍵は従来どおりデフォルト解決され、復元済み鍵の値は byte 等価である
```

## 受け入れ基準
- [x] presets の minimal / balanced / aggressive が CLEANSING_RULE_KEYS 上の allow / deny リストから派生する
- [x] restorable のクレンジング boolean セクションが CLEANSING_RULES の storageKeys から派生する
- [x] 派生鍵集合 == CLEANSING_RULES 鍵集合の網羅性テストが新設され green である
- [x] 既存 preset 値は byte 等価であり、復元挙動は4鍵が復元対象に加わる以外の差分がない
- [x] 既存バックアップ互換(migration pin: 旧 payload の欠落鍵はデフォルト解決)が保たれる
- [x] Category B 4鍵のバックアップ復元が skippedKeys 経路に落ちず sanitized に残る

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外(内部構造改善)

### 統合テスト
- バックアップ復元: Category B 4鍵を含む payload が sanitized に残り、旧 payload(4鍵なし)が従来どおり復元される
- preset 適用: minimal / balanced / aggressive 適用後の32値が golden pin と一致する

### 単体テスト
- 網羅性: 派生 presets 鍵集合と restorable boolean 鍵集合が CLEANSING_RULES 鍵集合と一致する
- 境界: isPresetMatch が全32鍵で判定し、1鍵でも不一致なら false を返す

## 実装アプローチ
- **Outside-In**: まず現状32キー全明示の preset 値を golden pin テストとして固定し(Red 不要の保護網)、次に網羅性テストを Red で書く
- presets 側は CLEANSING_RULE_KEYS 上の allow / deny リスト(preset ごとの ON 鍵列挙)から残りを導出する形に差し替え、golden pin が green のままであることを確認する
- restorable 側は CLEANSING_RULES の storageKeys から boolean セクションを導出する形に差し替え、4鍵が復元対象に加わる差分のみであることを確認する

## 見積もり
2ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: 他候補とは独立。クレンジング系 PBI の直前に完了していることが望ましい
- 遵守すべき方針: SSOT は CLEANSING_RULES のみとし、presets と restorable に鍵文字列の重複所有を残さない
- 非機能要件: 既存 preset 値・復元挙動は4鍵が復元対象に加わる以外 byte 等価。isPresetMatch の走査対象が preset エントリ依存でなくなる

## 実装者向け注記

### 現状の証拠
- SSOT: `src/utils/aiSummaryCleaner/rules.ts:141-184` — `CLEANSING_RULES`(32行)。`src/utils/aiSummaryCleaner/rules.ts:187` の `CLEANSING_RULE_KEYS` は既に派生済み
- presets の手書き列挙: `src/utils/aiSummaryCleaner/presets.ts:36-143` — minimal / balanced / aggressive の 3x32 フラグを手書き。`src/utils/aiSummaryCleaner/presets.ts:156-163` の `isPresetMatch` は preset エントリのみ走査するため PRESETS 忘れは preset 判定も壊す
- restorable の欠落: `src/utils/storage/restorableSettings.ts:55-85` — クレンジング boolean セクションに news_media / ec_site / qa_site / video_site の4鍵がない。`src/utils/storage/types.ts:185-188` には4鍵が実在する
- 欠落の影響経路: `src/utils/storage/restorableSettings.ts:220-228` — allowlist 不一致は skippedKeys 行きのため4フラグが黙って落ちる
- 設計上の注意: presets は camelCase の config 鍵(`altEnabled` 等)、restorable は storage 鍵(`ai_summary_cleansing_alt` 等) — 同一テーブルからの2つの派生になる設計。`CleansingRule` の `key` と `storageKey` をそれぞれ変換元にする

## Definition of Done
- [x] 全BDDシナリオ実装+パス
- [x] コードレビュー完了
- [x] 統合検証 green
