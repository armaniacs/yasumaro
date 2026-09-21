# PBI [spike]: エクスポート JSON serde の WASM 化可否を計測で判定する（移植は約束しない）

## ユーザーストーリー

開発者として、`exportJson`/`importLogsService` の serde を WASM 化すべきか計測で決めたい、なぜなら 10k 行で stringify 7.5ms・parse 6.0ms の実測に対し、WASM マーシャリング往復が支配的になって「負ける」可能性が高く、未計測のまま着手してはならないから（lessons-learned「計測してから」）

## 優先度

- 順位: 4 / 4（本計画の P4・スパイク枠）
- RICEスコア: 2.4（Reach=3 / Impact=1 / Confidence=40% / Effort=0.5週）
- 根拠: 実測（初回発見時の実測プローブ。着手時に bench/probe で再計測）10k 行＝3.6MB で stringify 7.49ms、parse 6.05ms。頻度は低い（ユーザー明示操作）。Confidence が低いのは `serde-wasm-bindgen` の往復コストが未知数だから。本 PBI は移植ではなく判定が成果物

## ビジネス価値

「やらない」の記録が次回の重複調査を防ぐ資産になる。勝てば P2 群の後続移植に、負ければ確定判断として最終報告に残る

## BDD受け入れシナリオ

```gherkin
Scenario: 計測で勝敗が判定される
  Given `exportJson` の 10k 行コーパス（3.6MB）
  When TS 実装と serde 試作（bincode 含む）を同一条件で実測する
  Then 倍率・ヒープ差・小入力の振る舞いが表で報告される

Scenario: 負けたら移植しない
  Given WASM 試作が TS に負けた
  When 判定する
  Then 「移植しない」を確定判断として記録し、理由を最終報告に残す

Scenario: 署名部は対象外である
  Given HMAC 署名・検証（非同期 WebCrypto）
  When スコープを決める
  Then 署名部は移植対象外として切り分けられ、理由（原則1: ネイティブが最速）が記録される
```

## 受け入れ基準

- [ ] 同一コーパス・同一マシンでの TS vs 試作の実測表（倍率・ヒープ・小入力）
- [ ] 勝敗判定と次のアクション（移植 PBI 起票 or 「移植しない」確定）の記録
- [ ] HMAC 署名部を対象外とした切り分けの記録
- [ ] 判定結果を計画レポートに追記する

## テスト戦略（t_wadaスタイル・Outside-In）

### E2Eテスト

- 対象外（スパイク）

### 統合テスト

- 対象外（スパイク。試作はリポジトリ外に隔離し、リポジトリ実ファイルは変更しない）

### 単体テスト

-  round-trip 等価性（試作レベル）: JSON→bincode→JSON で行数・内容が一致すること

## 実装アプローチ

- スパイク: 試作は使い捨て。成果物は計測表と判定記録のみ
- 移植判断が出た場合のみ、別 PBI で本移植を計画する

## 見積もり

0.5週（要チームでの見積もり）

## 技術的考慮事項

- 依存関係: なし
- 遵守すべき事項: lessons-learned「移植しない判断の実績」（serde は計測してから）。小入力 0.72x の教訓

## 判定記録（2026-09-21 実施・結論: 非反転 → 移植しないで確定クローズ）

スパイク試作（使い捨てクレート serde-spike、リポジトリ外隔離・wasm-pack + serde_json/serde-wasm-bindgen/bincode）による実測。コーパスは 10k 行（pretty 5.91MB / compact 5.20MB）。

| バリアント | 10k行 | 100行（小入力） |
|---|---|---|
| TS JSON.parse（pretty） | 5.38ms | 0.060ms |
| TS JSON.stringify（pretty） | 5.32ms | — |
| WASM untyped roundtrip（serde_json::Value） | 25.8ms（0.21x） | — |
| WASM typed roundtrip（compact） | 20.1ms（0.27x） | 0.212ms（0.28x） |
| WASM typed pretty（exportJson の直接置換） | 22.2ms（0.24x） | — |
| WASM typed→bincode（4.68MB） | 16.9ms（0.32x） | — |
| WASM rows_to_json（JsValue→serde、現実的な採用形状） | 26.5ms（0.20x） | — |
| WASM json_to_rows（serde→JsValue） | 29.5ms（0.18x） | — |

round-trip 等価性は全バリアント OK（内容は正しく保持される。問題は速度のみ）。

判定の理由:

1. **serde-wasm-bindgen の往復コストが判明**: V8 ネイティブ JSON の4〜5倍。JsValue↔serde のリフレクション変換と UTF-8 コピーが支配的
2. **JSON.parse/stringify は V8 の最適化済みネイティブ経路**であり、pii-sanitizer（複雑な正規表現交替を置き換えて勝ち）と違い、置き換え先がネイティブ最速のプリミティブ。転送律速+ネイティブ最速の二重の壁
3. bincode（コンパクトバイナリ）でも JSON.stringify 未満 — 中間形式の導入も利得なし
4. iteration-1 の eval-2 先行判断（「serde化は勝機なし」）を、serde 実測で裏付けた形

結論: **移植しない（確定）**。エクスポート経路の改善は署名対象の設計変更（eval-2 で特定の HMAC pretty 再シリアライズ排除）へ委ねる。試作クレートはリポジトリ外隔離のまま破棄（判定記録と実測 JSON は本ファイルと `bench/` 履歴に保持）。
