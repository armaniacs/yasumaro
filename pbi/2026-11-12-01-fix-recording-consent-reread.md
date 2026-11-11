# PBI: 録画パイプラインの実行時同意再読ゲート

## ユーザーストーリー
利用者として、プライバシー同意を撤回したら進行中の録画も止まってほしい、なぜなら撤回後に閲覧内容が保存・AI送信され続けるのは同意の約束に反するから

## 優先度
- 順位: 1/1 (NV-1 検証 firing 受け)
- RICE: 8.0 (Reach=4 / Impact=4 / Confidence=1.0 / Effort=2)
- 根拠: GDPR Art.7 撤回容易性に直結。ダミー実験で発火確定 (6/6)。最小修正で閉じる
- 依存: なし

## 現状 (検証済み事実)
- `src/background/recordingAdmission.ts`: `admit()` が intake 時に `isRecordingAllowed()` (= hasPrivacyConsent) を1回だけ確認し、以降の再読なし
- `src/background/pipeline/RecordingOrchestrator.ts`: `record()` は per-URL mutex 待機後に実行するが同意再読なし。`opts.settings` 渡し時はキャッシュ再読すらしない。`executeInternalInner` 内に同意ゲートなし (grep 確定)
- 同意は Settings blob 外 (`settingsMigration.ts` の TOP_LEVEL_ONLY) のため settings 再読では観測不可
- 発火デモ: `src/background/pipeline/__tests__/consentToctou.probe.test.ts` (firing、両経路で sink 発火を確認)
- 参考実装: `src/background/offlineQueueProcessor.ts:116` の実行時 `isConsentGranted` 再読

## BDD受け入れシナリオ

```gherkin
Scenario: mutex待機中の撤回で録画が止まる
  Given per-URL mutex で待機中の録画要求がある
  When 待機中に同意が撤回され mutex が解放される
  Then privacy_consent_required で拒否され sqlite/obsidian/AI の sink は呼ばれない

Scenario: caller-owned-settings 経路でも止まる
  Given manual/save 相当の opts.settings 付き要求が待機中である
  When 待機中に同意が撤回される
  Then 同様に拒否され sink は呼ばれない

Scenario: 同意が維持されれば従来通り録画される
  Given 待機中に撤回がない
  When mutex が解放される
  Then 従来通り録画が実行される (回帰なし)
```

## 受け入れ基準
- [ ] (1) mutex 解放直後に `isConsentGranted` (または同等 seam) を再読し、撤回時は `privacy_consent_required` で拒否する
- [ ] (2) caller-owned-settings 経路も同一ゲートで守られる (settings 自体に同意がないため別 seam が必須)
- [ ] (3) `consentToctou.probe.test.ts` を実 execute 経路の回帰ガードへ昇格させる (SCOPE ブロック記載の通り)
- [ ] (4) 既存の recording/orchestrator 系テストが全件緑を維持する

## テスト戦略
- 発火デモ probe を回帰テストへ昇格 (stub 配線から実 execute 経路へ)
- 境界値: 撤回タイミング (待機前/待機中/解放直後) の3点
- 回帰: RecordingOrchestrator 系 + offlineQueue 系テスト全件

## 見積もり
- S

## Definition of Done
- [ ] 全BDDシナリオが自動テスト化され、すべてパスする
- [ ] コードレビューが完了している
- [ ] 受け入れ基準のすべての項目が満たされている

## 出典
- security-audit run-1 NV-1 (`security-audit-yasumaro-run-1/NEEDS-VALIDATION.md`)
- 検証Go承認 (2026-11-12、pbi/2026-11-12-00-backlog-security-audit-run1.md)
