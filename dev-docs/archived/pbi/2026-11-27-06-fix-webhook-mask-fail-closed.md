# PBI: webhook mask seam を size-rejection で fail-closed にする (CWE-754 Low)

## ユーザーストーリー
拡張機能ユーザーとして、unmaskable テキストが webhook で素のまま送信されないようにしたい、なぜなら sender の契約は "Fail closed: an unmaskable title or summary is never shipped raw" だが、>64KB 入力に対する sanitizeRegex の size-rejection が throw ではなく「元テキスト + 無視される error フラグ」を返し、マスクをバイパスした素の PII が POST される (VulnHunter VULN-401、CWE-754 Low) から。

## ビジネス価値
- "nothing unmasked egresses" 不変条件の違反 (size-rejection 経路) を塞ぐ
- 測定方法: exploit test 401 を新契約 pin に更新 (>64KB テキストで maskError が発生し、send が抑制されること)

## BDD受け入れシナリオ

```gherkin
Scenario: >64KB テキストはマスク失敗として抑制される
  Given >65,536 文字の summary が含まれるレコードがある
  When webhook send が実行される
  Then defaultWebhookMaskText が throw し、sendWebhookExport の既存 fail-closed catch が処理する
  And POST は発生せず、mask-error history 行が記録される
```

## 受け入れ基準
- [x] defaultWebhookMaskText (webhookExportSender.ts:167-170) が result.error (またはテキスト長超過) を検出して throw する
- [x] 既存 fail-closed catch (webhookExportSender.ts:295-307) が処理する経路になる (mask-error history 行も記録)
- [x] exploit test 401 を新契約 pin に更新
- [x] 2 番目の seam caller (src/dashboard/webhookExportSettings.ts:87、unwired) を mirror するか、未配線である旨をコメントで明記
- [x] `npm run validate` が通る

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- webhook send 経路テスト群 (新契約 pin)

### 単体テスト
- defaultWebhookMaskText の境界 (>64KB で throw、<64KB でマスク結果返却)

## 見積もり
S (2 SP、要チームでの見積もり)

## 技術的考慮事項
- 出所: yasumaro_VULNHUNT_RESULTS_2026-11-27-190000/phase2b_output.md VULN-401 (CONFIRMED Low)、phase3_output.md fix strategy
- 外部挙動: 意図的な fail-closed 化 (挙動変更)。旧挙動 (素のまま送信) は脆弱であったため意図的変更
- 依存関係: なし (seam 1 箇所)
- ロールバック: error フラグ無視に戻す (1 コミット、脆弱状態に戻る)

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
sed -n '165,172p' src/background/webhookExport/webhookExportSender.ts
sed -n '215,228p' src/utils/piiSanitizer.ts
sed -n '82,92p' src/dashboard/webhookExportSettings.ts
```

### 実装手順
1. defaultWebhookMaskText に result.error チェックを追加 (throw)
2. exploit test 401 を新契約 pin に更新
3. webhookExportSettings.ts:87 の mirror 判断 (未配線ならコメントのみ)

### 落とし穴
- throw 経路の mask-error history 記録 (sender.ts:295-307) は既存 ― 新 throw も同じ catch に落ちる
- throw 文言は既存 maskError 文言の流儀に合わせる (大文字小文字・文言の pin テストがあれば更新)
- git 操作禁止。実時間待ち禁止

## Definition of Done
- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす (統合/単体)
- [x] コードレビュー完了 (セキュリティ変更のため For Security Review Agents 観点を PR 説明に明記)
- [x] リファクタリング完了 (グリーン後)
- [x] ロールバック手段: throw を外し旧挙動に戻す (1 コミット、脆弱状態に戻る)
- [x] ドキュメント更新の要否判定: fail-closed 挙動の文書化 ― webhookExportSender.ts ヘッダコメント (295-307) で契約が既に記載済みのため docs 更新は不要
