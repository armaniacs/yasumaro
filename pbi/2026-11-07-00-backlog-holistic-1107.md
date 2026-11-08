# 台帳: 大局的改善ラウンド 2026-11-07 (holistic-1107)

出所: 大局的コードレビュー報告書(サブエージェント実施、2026-11-07受領) テーマ TOP 5。
対象: コードベース全体(`src/` + `cli/`)。観点 DRY/SoC/拡張性/堅牢性。
検証コマンド: `npm run type-check` / `npm run lint` / `npm test` / `npm run build` (+ Rust分は `cli/` で `cargo test`・`clippy -D warnings`・`fmt --check`)。
アーカイブ先: `dev-docs/archived/pbi/`。

## RICE採点表 (Reach 1-10 / Impact 3-2-1-0.5 / Confidence 1.0-0.8-0.5 / Effort SP)

| 順 | ID | 候補 | 種別/規模 | R | I | C | E | RICE | 依存 |
|----|----|------|-----------|---|---|---|---|------|------|
| 1 | C1 | shim新規import禁止lint拡大 | refactor/S | 6 | 1 | 1.0 | 1 | 6.0 | - |
| 2 | C7 | raw storage検出lint | refactor/S | 5 | 2 | 0.8 | 2 | 4.0 | - |
| 3 | C2 | 旧経路付け替え+参照ゼロshim削除 | refactor/M | 5 | 1 | 1.0 | 3 | 1.67 | - |
| 4 | C8 | raw呼び出しのアダプタ委譲置換 | refactor/M | 5 | 2 | 0.8 | 5 | 1.6 | C7直後(同一領域のため) |
| 5 | C3 | ブランド生成点固定テスト | refactor/S | 3 | 1 | 0.8 | 2 | 1.2 | - |
| 6 | C9 | CLI parity対応表コメント | docs/S | 2 | 0.5 | 1.0 | 1 | 1.0 | - |
| 7 | C4 | queryPlan分割(方策/文組み立て分離) | refactor/L | 4 | 2 | 0.8 | 8 | 0.8 | C3完了後 |
| 8 | C6 | validator二系統統合(調査→修正) | investigate/S | 3 | 1 | 0.5 | 2 | 0.75 | - |
| 9 | C5 | gatewayファクトリ化+3 gateway委譲 | refactor/M | 4 | 1 | 0.8 | 5 | 0.64 | - |

## 最終実行順 (NN)

純RICE降順そのまま。逸脱なし(C8はC7直後という依存上の要請が純順序と一致、C4はC3より後という依存が純順序と一致)。
`01`→`02`→`03`→`04`→`05`→`06`→`07`→`08`→`09` (ID順 C1,C7,C2,C8,C3,C9,C4,C6,C5)。

## 依存マップ

- C8 は C7 の後に実施 (同一 `src/background/` 領域・lint先行)。
- C4 は C3 の後に実施 (ブランド固定テストが安全網)。
- C5 と C6 は `src/messaging/` で領域が近いが触るファイルが異なるため別バッチ可。
- C9 (`cli/`) は他と独立。

## 台帳送り (今回対象外)

- 旧バックログ6件 (`2026-09-05-32` wasqlite sunset / `2026-09-22-11` hardening / `2026-09-25-29` gateway split / `2026-09-25-30` namespace reorg / `2026-09-26-12` TS7 / `2026-09-27-02` stryker): 進行中として残す。再検討トリガー: 本ラウンド完了後の次回 holistic 時に再評価。
- `2026-11-07-backlog-ai-model-review.md` 未チェック3件: 時限ゲート (2027-01四半期レビュー)。再検討トリガー: 2027-01到来。
- 除外候補なし (フェーズB確認で全件採点が承認済み)。

## DoD反映漏れ棚卸し結果

- アーカイブ重複なし (`pbi/` 側と同名ファイルは `dev-docs/archived/pbi/` に存在せず)。
- ai-model-review の未チェックは時限ゲートであり反映漏れではない。
- その他6件は実未完了 (セッション内で実装コミットなし)。
