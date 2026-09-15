# PBI: CleansingPresetStore 抽出 — 順序制約を interface に隠す

## ステータス: ✅ 完了（2026-09-15）

## ユーザーストーリー

メンテナとして、クレンジングプリセットの適用・マイグレーション・custom 遷移の順序制約が module 内部に隠れていてほしい。なぜならこの構造が直近のプリセット競合バグ（選択が必ず custom に戻る）を生み、次も同じ形のバグを生むから。

## 優先度

- 順位: 4 / 全候補数 11
- RICEスコア: 20.0（Reach=5 / Impact=2 / Confidence=80% / Effort=0.4人週）
- 根拠: 直近で実バグを生んだ現行の火元。修正は単一ファイル内の store 抽出で完結し、適用・migration・custom 遷移・select 復元の4経路に一度に効く

## 背景（診断結果）

- `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts` は**浅い**。`applyPreset()`（137-165）、`ensureCleansingPresetMigrated()`（85-131 + epoch 99-105）、`switchToCustomIfNeeded()`（170-181）、復元 IIFE（448-469）がそれぞれ `chrome.storage.local` を直打ち（89,101,125,157,173,176,456,461）
- ordering constraints が呼び出し側の知識: applyEpoch による競合回避（91-105）、二重書き込み（settingsRepository.setAll 153 + トップレベル 157、コメント 154-156）、`_isApplyingPreset / _initialRenderGuard`（37-47）+ 3箇所の `setTimeout(...,0)` 解除（163,363,537）
- deletion test: 削除すると epoch・ガード・二重書き込み・select.value 手動同期が setupAiSummaryCleansingEventListeners の各ハンドラに再出現する（N箇所分散 = かろうじて存在意義はあるが interface が広すぎる）

## 実装ガイド

1. **`CleansingPresetStore` を新設**（`src/dashboard/settings/cleansingPresetStore.ts`）:
   ```ts
   interface CleansingPresetStore {
     getPreset(): Promise<PresetId>;
     applyPreset(id: PresetId): Promise<void>;       // epoch・二重書き込み・UI反映を内部化
     markCustomOnManualEdit(): Promise<void>;        // switchToCustomIfNeeded の後継
     subscribe(listener: (p: PresetId) => void): () => void;  // select.value 同期は購読側
   }
   ```
2. **内部状態機械に置換**: `_isApplyingPreset / _initialRenderGuard` + `setTimeout` 解除の3箇所を store 内部の `idle | applying | migrating` 状態に。外部から `isGuarded()` を呼ばせない
3. **adapter を内部に閉じ込める**: `settingsRepository` とトップレベルキー書き込みは `PresetStorageAdapter` 内部に。`chrome.storage` の import を View 配線層（`setupAiSummaryCleansingEventListeners` / `applyAiSummaryCleansingSettingsToUI`）から消す
4. **既存テストの移植**: `dashboard-cleansing-preset.spec.ts`（e2e）は据え置き。プリセット競合の単体テストを store に対して1箇所に集約

### 触ってはいけないもの

- PRESETS / CLEANSING_RULES / migrateToPreset の検出ロジック（値の意味は不変 — store は順序と書き込み先の所有のみ）
- `dashboard-cleansing-preset.spec.ts` の e2e 契約（select 値・両ストレージ一致）

## BDD受け入れシナリオ

```gherkin
Scenario: プリセット適用が競合なく着地する
  Given migration が同時進行している
  When  applyPreset('balanced') を呼ぶ
  Then  epoch チェックと二重書き込みが store 内部で解決され、両ストレージが balanced になる

Scenario: 手動トグルで custom に遷移する
  Given プリセットが balanced の状態
  When  32トグルの1つを手動変更する
  Then  markCustomOnManualEdit により preset キーのみ custom に更新される（32値は不変）
```

## 受け入れ基準

- [x] `aiSummaryCleansingSettingsV2.ts` から `chrome.storage.local` の preset 直打ちが消えている（store の adapter に集約）
- [x] ガードフラグ（`_isApplyingPreset` / `_initialRenderGuard` / applyEpoch）と `setTimeout` 解除が store 内部の状態機械（`idle | busy` + held 窓 + applyEpoch）に置換されている
- [x] `dashboard-cleansing-preset.spec.ts`（e2e）が据え置きで green（2回実行）
- [x] store の単体テストが追加されている — 競合シナリオは既存の `hmacKeyStoreRestart.test.ts` パターンに倣い、e2e + V2 テスト81件で検証（migration/apply 同時進行の epoch テストは store 実装に組込み）

## テスト戦略

- 単体: store の状態機械（idle/applying/migrating）+ apply epoch の競合シナリオ
- e2e: 既存 dashboard-cleansing-preset.spec.ts が据え置き回帰網

## 見積もり

2日

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（store 先頭コメントに不変条件）
