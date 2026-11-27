# PBI: Code Quality 3 件の defense-in-depth hardening (オプション)

## ユーザーストーリー
保守担当者として、VulnHunter が Code Quality (脆弱性ではない) と降格した 3 件の defense-in-depth 課題を hardening したい、なぜなら修正 idioms が in-repo に存在し (storageTransaction CAS、fallback window bound、consent モデル改訂)、条件が変わった場合に脆弱化するから。

## ユーザーへの背景 (VulnHunter 報告書 §Code Quality)
- (1) CWE-312 plaintext-secret fallback — encryptionSession.ts:277-280 (KEK store 不可能時に legacy 平文を chrome.storage に書く。in-scope attacker は鍵有無に関わらず storage を直接読めるため脆弱性ではないが、fallback window の存在は defense-in-depth ギャップ)
- (2) CWE-367 lost-update race — RateLimitService.ts:127-149 (unlock flow のみに到達可能。extension-page tier は既に offline brute-force 可能のため脆弱性ではないが、CAS を通せば race は消える)
- (3) CWE-862 consent re-read asymmetry — privacyConsent.ts:439 vs coreCrudHandler.ts:98-105 (consent モデル改訂時の課題。現行脅威モデルでは elimination 確認済み)

## ビジネス価値
- 条件変化時の脆弱化リスクを事前に消す (hardening)
- 測定方法: (1)(2) の修正 idioms 適用後も全テスト緑、(3) は台帳に「次回 consent モデル改訂時に対応」の記録

## BDD受け入れシナリオ

```gherkin
Scenario: counter write は CAS 経由になる
  Given RateLimitService の unlock flow がある
  When failed-attempt counter が更新される
  Then storageTransaction CAS (storageTransaction.ts) を経由し、lost-update race が消える

Scenario: fallback window は bounded になる
  Given KEK store が利用不可能で plaintext fallback に入った
  When 次回 unlock が成功する
  Then plaintext 値が envelope 形式へ retry-wrap され、fallback window が閉じる
```

## 受け入れ基準
- [ ] RateLimitService.ts:127-149 の counter write が storageTransaction CAS 経由に変更されている
- [ ] encryptionSession.ts の plaintext fallback に unlock 成功時の retry-wrap (bounded window) が実装されている
- [ ] coreCrudHandler.ts:98-105 の consent re-read asymmetry は「次回 consent モデル改訂時に対応」を台帳に記録 (現行脅威モデルでは elimination 確認済み、実装は scope 外)
- [ ] 全テスト緑 (既存 unlock/lockout 試験含む)
- [ ] `npm run validate` が通る

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- unlock / lockout テスト群 (無変更で緑)

### 単体テスト
- CAS 経由 write、fallback window の境界 (unlock 成功後に wrap)

## 見積もり
S (3 SP、要チームでの見積もり)

## 技術的考慮事項
- 出所: yasumaro_VULNHUNT_RESULTS_2026-11-27-190000/phase2b_output.md (FALSE POSITIVE → Code Quality 2 件)、phase3d sweep (RC 一覧)
- 外部挙動: 完全に不変 (race の消去と fallback window bound のみ)。unlock flow の失敗回数カウント挙動は同一
- 依存関係: storageTransaction (既存)、encryptionSession (既存)
- オプション性: 本 PBI は脆弱性修正ではない (Code Quality)。着手タイミングは次ラウンドでも可
- (3) の consent asymmetry は consent モデル改訂 PBI の前提条件に含めるべき (本 PBI では実装しない)

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
sed -n '120,155p' src/utils/RateLimitService.ts
sed -n '270,290p' src/utils/storage/encryptionSession.ts
sed -n '95,110p' src/background/handlers/coreCrudHandler.ts
```

### 実装手順
1. RateLimitService.ts の counter write を storageTransaction CAS 経由に (既存 lock/unlock 試験が緑を確認)
2. encryptionSession.ts に unlock 成功後の plaintext → envelope retry-wrap を実装 (window bound)
3. 台帳に (3) の記録を追加

### 落とし穴
- CAS の既存利用パターン (SettingsRepository.ts) に倣う (自前実装しない)
- (1) の CAS 化で counter 記録の遅延が unlock flow に波及しないこと (既存試験が pin)
- git 操作禁止。実時間待ち禁止

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす (統合/単体)
- [ ] コードレビュー完了
- [ ] リファクタリング完了 (グリーン後)
- [ ] ロールバック手段: 各 hardening は独立コミット (単独リバート可)
- [ ] ドキュメント更新の要否判定: 内部 hardening のため docs 更新は不要
