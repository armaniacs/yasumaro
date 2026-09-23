# バックログ: レビュー findings 対応 PBI（2026-09-19 第3波・r3） — ✅ 全3件完了（22・21・23 アーカイブ済み）

元レポート: 未コミット変更レビュー（基準3文書照合）の findings 3件
採点方式: RICE（Reach×Impact×Confidence/Effort）
依存関係: 22 は PBI 06・15 に、21 は PBI 15 に、23 は PBI 05・18 に依存（いずれも実装済み）。候補間のファイル重複なし

完了状態（2026-09-19 アーカイブ時）:
- 22: handler 転送テスト5件新設・connectionTests 新契約更新・80 tests green
- 21: 保存ゲート統合テスト新設・Red/Green 検証済み・16 tests green
- 23: JSDoc test seam 明記・15 tests green

再調査の結果（実装者判断の訂正を含む）:

- F1 確定: `settingsPipeline.test.ts` に `http_non_loopback_blocked` のテストなし。加えて fieldValidation モックに `setFieldError` が未登録で、ゲート経路を動かすと即 TypeError になる
- F2 訂正: レビュー時に一時疑った「trust level 不整合（content-script-allowed）」は誤り。該当リストは VALID_MESSAGE_TYPES であり、実際の `CONTENT_SCRIPT_ALLOWED_TYPES` は4型のみで TEST_OBSIDIAN は extension-only。真因は `TestObsidianMessage` payload 型が `{apiKey}` のみで handler がフォーム値を捨てていること
- F3 確定: `getAbsentVersionCount` の参照はテストのみ（本番診断は logInfo に移行済み）

## 順位表

| 順位 | 候補 | RICE | 内訳（R/I/C/E） | 根拠 | ファイル |
|------|------|------|----------------|------|----------|
| 22 | Test Connection host パリティ | 48 | 20/2/80%/0.67 | 機能未達の解消＋境界整合。工数小 | 2026-09-19-22-fix-test-connection-host-parity.md |
| 21 | 保存ゲート統合テスト | 24 | 10/1/80%/0.33 | TEST_RULE 違反解消・回帰防止 | 2026-09-19-21-fix-save-gate-integration-test.md |
| 23 | absent count JSDoc | 20 | 5/0.5/80%/0.1 | コメント是正のみ | 2026-09-19-23-fix-absent-count-jsdoc.md |

## findings との対応（なぜなぜ分析）

| finding | PBI | なぜなぜ要約 |
|---------|-----|-------------|
| 1: 保存ゲートにテストなし | 21 | なぜない→ゲート追加時にテストファイル未更新→なぜ→isLoopbackHost 単体テストを「検証済み」と見なした→なぜ不十分→単体は配線（host 渡し・分岐順序・エラー表示）を検証しない→解: 保存経路の統合テスト追加＋setFieldError モック拡張 |
| 2: host が本番経路で到達不能 | 22 | なぜ届かない→handler が payload を {apiKey} に削る→なぜ→payload 型に protocol/port/host が無い→なぜ無い→PBI 15 で builder 側だけ拡張しメッセージ契約側を更新し損ねた→解: payload 型拡張＋handler 転送（空値フィルタ）＋dashboard 送信＋シグネチャ更新。trust level は extension-only 維持（再調査で確認） |
| 3: getAbsentVersionCount 未使用 | 23 | なぜ→PBI 18 で診断を logInfo に変更し getter の用途記述が陳腐化→解: JSDoc を test seam として明記 |

## 推奨着手順

22 → 21 → 23（RICE 降順。相互依存なし）

## 前提となる前波 PBI

22→06/15、21→15、23→05/18（すべて 2026-09-19-01〜20 に含まれ、実装済み）
