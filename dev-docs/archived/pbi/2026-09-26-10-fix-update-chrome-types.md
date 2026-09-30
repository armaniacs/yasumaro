# PBI: @types/chrome を 0.3.0 へ更新する

## ユーザーストーリー

開発者として、Chrome API の型定義を 0.3.0 に更新したい。なぜなら新しい Chrome API の型を正確に利用でき、0.2.x と Chrome 本体の乖離による誤った型利用を未然に防げるから。

## 優先度

- 順位: 1 / 3（2026-09-26 依存更新ラウンド。採点の全体像は [2026-09-26-00-backlog-dependency-updates.md](2026-09-26-00-backlog-dependency-updates.md)）
- RICEスコア: 4.0（Reach=2 / Impact=0.5 / Confidence=1.0 / Effort=0.25）
- 根拠: 0.3.0 の適用を実測検証済みでドロップイン互換。全候補中最小工数で即実施可能。他候補との依存なし

## 背景（実測・2026-09-26）

- 依存棚卸し（`npm outdated`）で `@types/chrome` 0.2.9 → 0.3.0（メジャー更新）を検出
- 0.3.0 を仮適用して検証した結果:
  - `npm run type-check`（本体）: エラー 0 件
  - `npm run type-check:test`（test プロジェクト）: 型エラーの発生箇所リストが 0.2.9 時点と完全一致（diff 0 件）
- メジャー更新だが実測では影響ゼロ。「メジャー=危険」ではなく実測で判断してよい

## BDD受け入れシナリオ

```gherkin
Scenario: 型定義更新が本体コードに影響しない
  Given @types/chrome 0.3.0 がインストールされている
  When npm run type-check を実行する
  Then エラー 0 件で終了する

Scenario: test プロジェクトの型エラーが増えない
  Given @types/chrome 0.3.0 がインストールされている
  When npm run type-check:test を実行する
  Then 型エラーの発生箇所が更新前と同一である
  And 新規に発生したエラー箇所は 0 件である

Scenario: 依存ゲートが PASS する
  Given 依存更新が完了している
  When npm run release:check:deps を実行する
  Then npm audit とライセンス検査と lockfile 一致検査がすべて PASS する
```

## 受け入れ基準

- [x] `package.json` の `@types/chrome` を `^0.3.0` に更新し、`package-lock.json` も同期している（実装コミット `afde6f6c`）
- [x] `npm run type-check` がエラー 0 件で終了する（実測 exit 0）
- [x] `npm run type-check:test` の型エラー発生箇所が更新前と同一である（実測 diff 0。既存の型エラー 278 件は先行ドリフトであり本 PBI のスコープ外。修正は別途）
- [x] `npm run validate` が PASS する（実測 927 ファイル / 14,375 tests green）
- [x] `docs/DEPENDINGS.md` の「意図的に未反映の残り 3 件」表から `@types/chrome` を除去する

## テスト戦略

- E2E: なし（型定義のみの更新で実行時動作に影響しない）
- 統合: `npm run validate`（lint + type-check + 全単体テスト）が実質のゲート
- 単体: なし（型定義の差分はコンパイラが検証する。テストコードを書かない）

## 見積もり

0.25 SP（難易度 🟢低）

## DoD

- [x] 上記受け入れ基準をすべて満たす
- [x] `docs/DEPENDINGS.md` が更新されている

## 参考

- `docs/DEPENDINGS.md` — 依存棚卸しと未反映理由の記録
- 同ラウンドの監視 PBI: [2026-09-26-12-backlog-typescript-7-adoption.md](2026-09-26-12-backlog-typescript-7-adoption.md)（typescript の peer 制約を踏まえた同時更新の要否は本 PBI に影響しない — `@types/chrome` は TypeScript 6/7 両方で動作することを実測済み）
