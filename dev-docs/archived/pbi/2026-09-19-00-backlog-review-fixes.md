# バックログ: レビュー findings 対応 PBI（2026-09-19 第2波）

元レポート: ローカルレビュー（uncommitted changes、NEEDS CHANGES）の findings 7件
採点方式: RICE（Reach×Impact×Confidence/Effort）。全候補を同一基準で相対比較
依存関係: 14 は 09-19-01（Offscreen 上限）に依存、15 は 09-19-06（http ブロック）に依存、17 は 09-19-07（apiKeySource）に依存、18 は 09-19-05（absent 格下げ）に依存、20 は 14 と挙動を揃える。19 は独立

## 順位表

| 順位 | 候補 | RICE | 内訳（R/I/C/E） | 根拠 | ファイル |
|------|------|------|----------------|------|----------|
| 14 | クレンジング超過のフォールバック抜け穴 | 80 | 100/2/80%/2 | main thread ブロッキング残存。上限の効果を無効化 | 2026-09-19-14-fix-cleansing-oversize-fallback-bypass.md |
| 15 | 保存時 http＋非loopback 検証 | 40 | 20/2/80%/0.8 | 保存成功・同期失敗の不整合。Test Connection 一致も含む | 2026-09-19-15-fix-settings-http-loopback-save-gate.md |
| 16 | ガードスクリプトの CI 組み込み | 32 | 10/2/80%/0.5 | 「enforced by」コメントが虚偽のまま。工数極小 | 2026-09-19-16-fix-guard-scripts-ci-wiring.md |
| 17 | apiKeySource の診断出力 | 16 | 10/1/80%/0.5 | 書きっぱなしフィールドの目的を回復 | 2026-09-19-17-fix-apikey-source-diagnostics.md |
| 18 | absent カウンタの診断表示 | 12 | 5/1/80%/0.33 | 移行完了判断を可能にする仕上げ | 2026-09-19-18-fix-absent-version-counter-diagnostics.md |
| 19 | PBI 11・12 のアーカイブ是正 | 10 | 5/1/80%/0.4 | pbi/ 運用規約（未完了のみ置く）の遵守 | 2026-09-19-19-fix-pbi-archive-hygiene.md |
| 20 | 同期クレンジングにもサイズ上限 | 8 | 5/1/80%/0.5 | flag 無効環境のみ。14 と挙動一致が必要 | 2026-09-19-20-fix-sync-cleansing-size-limit.md |

## findings との対応

| finding | PBI | なぜなぜ要約 |
|---------|-----|-------------|
| 1: サイズ拒否が同期フォールバックで無効化 | 14 | なぜ通るか→delegate が全 failure を同期に委譲→なぜか→failure 種別の区別が未設計→解: too large を機械可読に分類し同期パースをスキップ |
| 2: 保存時検証なし・Test Connection 不一致 | 15 | なぜ保存できるか→クロス検証が保存経路にない→なぜか→validateProtocol は単項目で host を知らない→解: settingsPipeline に集約＋override に host 追加 |
| 3: check-deprecated-aliases 未接続 | 16 | なぜ走らないか→スクリプト追加だけ行い gate 編集を欠いた→解: validate＋CI に追加 |
| 4: 同上の重複主張 | 16 | 同根（3と同一解） |
| 5: apiKeySource 未読 | 17 | なぜ読まれないか→診断出力の実装が PBI 07 の範囲外だった→解: 構築時ログに追加 |
| 6: 同上（Gemini） | 17 | 同根 |
| 7: getAbsentVersionCount 未読 | 18 | なぜ未読か→カウンタだけ先行実装し表示先が未定→解: diagnostics パネルに表示 |

## 推奨着手順

1. 14（最高の実害。09-19-01 の効果を確定させる）
2. 15・16（利用者影響と保証の実効化）
3. 17・18（診断性の仕上げ）
4. 19・20（運用是正・均衡保護）

## 前提となる前波 PBI

14→01、15→06、17→07、18→05 が未実装の場合は先に完了させること（いずれも 2026-09-19-01〜13 に含まれ、実装済み）
