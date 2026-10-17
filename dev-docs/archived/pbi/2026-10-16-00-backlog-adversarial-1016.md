# Backlog: adversarial-1016（7a3a39e0 差分対象・検証通過分のみ）

adversarial-code-review (2026-10-16) の発見はハッカー 12件・保守 97件。裏取り（発見とは独立の反証部隊＋配線の自前確認）で SURVIVES 21件のみを残し、残りは却下した。却下の主類型: 本番到達不能（デッド経路・テストのみ到達）、テスト pin 済みの意図動作、URL パーサ正規化で不成立、MV3 で修正不能（DNS 解決手段なし）。

## RICE 一覧

| 順位 | PBI | RICE | 内訳 R/I/C/E | 根拠 |
|---|---|---|---|---|
| 01 | [2026-10-16-01-fix-export-batch-tags-time.md](2026-10-16-01-fix-export-batch-tags-time.md) | 108 | 60/1/0.9/0.5 | batch 輸出の全件でタグ消失・時刻平坦化＋U+2028 行偽造。同ファイル小修正 |
| 02 | [2026-10-16-02-fix-openai-missing-apikey-gate.md](2026-10-16-02-fix-openai-missing-apikey-gate.md) | 96 | 20/1.5/0.8/0.25 | キーなし本文 POST。Gemini 対照あり。送信先 allowlist 拘束で低〜中 |
| 03 | [2026-10-16-03-fix-migration-backup-terminal-state.md](2026-10-16-03-fix-migration-backup-terminal-state.md) | 64 | 20/2/0.8/0.5 | 空 stuck・不一致リプレイ。legacy 保持者の毎起動実害 |
| 04 | [2026-10-16-04-fix-settings-import-units-strip.md](2026-10-16-04-fix-settings-import-units-strip.md) | 36 | 15/1.5/0.8/0.5 | 単位不一致・保存/返却不一致。2箇所小修正 |
| 05 | [2026-10-16-05-fix-headerdetector-url-hash-log.md](2026-10-16-05-fix-headerdetector-url-hash-log.md) | 32 | 10/0.5/0.8/0.125 | 生 URL 永続化（稀・local のみ）。2行修正 |
| 06 | [2026-10-16-06-fix-clamplimit-default-constant.md](2026-10-16-06-fix-clamplimit-default-constant.md) | 20 | 5/0.25/1.0/0.0625 | 二重管理の予防。1行＋pin |
| 07 | [2026-10-16-07-fix-focustrap-outside-escape.md](2026-10-16-07-fix-focustrap-outside-escape.md) | 10 | 20/0.5/0.5/0.5 | 拡張ページ内限定の hardening。確信度低め |
| 08 | [2026-10-16-08-chore-publish-robustness-bundle.md](2026-10-16-08-chore-publish-robustness-bundle.md) | 8 | 5/2/0.8/1.0 | 障害時の切り分け cost。10件束ね |

依存関係なし（全て異なるファイル・独立）。実装順は RICE 順。

## 却下記録（代表）
- 数値形 IP 迂回：WHATWG URL が hostname 時点で正規化し検出（node 実測＋テスト pin）。不成立。
- nip.io / DNS リバインディング：文字列検査の限界は事実だが MV3 に解決手段なし。既知制約として記録のみ。
- `isLocalUrl` 系・未知 id 直構築・factory 差替：コード欠陥自体は実在するが本番到達不能（唯一の呼出はデッド経路、本番呼出ゼロ）。対象外。
- `logDebug` 生 URL：本番 no-op。対象外。
- 保守 AI 29件：全件却下（到達不能・pin 済み意図動作・誤読・実害なし）。
- publish 7件（token object・status 表示・timeout・沈黙 skip・202・表記・StepFailed 契約）：仕様・テスト・明示ログで反証。
- settings 5件（未来版・v1 無署名・ログ詳細・他値域・undefined）：merge・暗号認証・PII 設計・到達不能で反証。
- offscreen 23件中 20件：backend 事前弾き・単一スレッド直列・上流拒否・poll 読取等で反証。SURVIVES は #1/#2/#14 のみ（本 PBI 化）。

## なぜなぜ分析
疑問は反証フェーズで解消済みのため追加の深掘りはなし。各 SURVIVES の根本原因は「受渡し漏れ・gate 漏れ・終端漏れ・単位錯誤」のいずれかで、解は各 PBI の受け入れ基準に直結する。
