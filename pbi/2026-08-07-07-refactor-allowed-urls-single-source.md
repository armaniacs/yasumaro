# PBI: 許可URL二重実装の単一ソース化とポートデフォルト不一致の修正

**作成日**: 2026-08-07
**優先度**: 高
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟡軽微（host_permissionsに影響するロジック変更。既存機能の動作検証必須）
**種別**: 🔧非機能追加（refactor）

---

## 背景

コードレビューで `settingsStore.ts` と `allowedUrls.ts` にほぼ同一の許可URL構築ロジックが二重実装されていることが発見された。さらに**両者でObsidianポートのデフォルト値が不一致**という実バグが含まれる。

### 重複の詳細

| 関数 | `settingsStore.ts` | `allowedUrls.ts` |
|------|-------------------|------------------|
| `buildAllowedUrls` | 565-651 | 17-91 |
| `computeUrlsHash` | 658-661 | 98-101 |
| `saveSettingsWithAllowedUrls` | 667-673 | 108-115 |
| `getAllowedUrls` | 679-683 | 122-126 |

`buildAllowedUrls` はほぼverbatim（Obsidian/Gemini/OpenAI互換/uBlockソース/固定ドメインの同じ構造）。

### 差異とバグ

| 項目 | `settingsStore.ts` | `allowedUrls.ts` |
|------|-------------------|------------------|
| **Obsidianポートデフォルト** | `27123`（正: `defaults.ts:14` と一致） | **`27124`（誤）** |
| OpenAI互換provider_base_url | あり（614-627） | なし |
| `saveSettingsWithAllowedUrls` | `saveSettings` + `updateDomainFilterCache` | `saveSettingsFunc` 呼び出しのみ |

**バグの影響**: `allowedUrls.ts` 経由で構築された許可URLはポート`27124`を使うため、実Obsidianポート(`27123`)と不一致。host_permissions の許可URLが正しく設定されず、Obsidianへの書き込み権限が失われる可能性がある。

### 呼び出し経路（両方が現役）

```
settingsStore.buildAllowedUrls ← service-worker.ts, messageHandlers.ts
allowedUrls.buildAllowedUrls   ← storageUrls.ts（バレル）→ 13ファイルが間接的に使用
```

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -rn "buildAllowedUrls\|getAllowedUrls\|computeUrlsHash\|saveSettingsWithAllowedUrls" src/ --include="*.ts" | grep -v __tests__
grep -n "2712[34]" src/utils/storage/defaults.ts src/utils/storage/settingsStore.ts src/utils/allowedUrls.ts
grep -n "buildAllowedUrls" src/utils/storage.ts src/utils/storageUrls.ts
```

## 受け入れ基準（BDD）

```gherkin
Scenario: buildAllowedUrlsが単一ソースから提供される
  Given settingsStore.ts と allowedUrls.ts の両方に存在する状態
  When 両者からインポートされた関数を呼ぶ
  Then 同一の結果（特にObsidianポートデフォルト27123）が返る

Scenario: ポートデフォルトが不正な値でない
  Given allowedUrls.ts の旧実装が '27124' を使う状態
  When 置換後の単一実装を呼ぶ
  Then Obsidianポートデフォルトとして '27123' が使われる

Scenario: provider_base_url が許可URLに含まれる
  Given provider_base_url が設定されている状態
  When 単一実装で許可URLを構築する
  Then provider_base_url が許可URLに追加される
```

## 受け入れ基準
- [ ] `settingsStore.ts` の `buildAllowedUrls` を単一ソースとし、`allowedUrls.ts` から再エクスポート（または逆）で統一
- [ ] ポートデフォルト値を `defaults.ts` の単一定義から参照し、ハードコードを排除
- [ ] `provider_base_url` 処理を両実装で共通化（現状settingsStore側にのみ存在）
- [ ] `storage.ts` と `storageUrls.ts` の両バレルが同一実装を指すことを確認
- [ ] 既存テストが全てパスする

## テスト戦略

### 単体テスト
- `buildAllowedUrls` の単体テスト：ポートデフォルト、provider_base_url含む/含まない、uBlockソース、固定ドメイン
- デフォルト値が `defaults.ts` と一致することを検証

### 回帰テスト
- `saveMetadataStep`, `messageHandlers`, `recordCurrentPage` 等の許可URL利用パスの動作確認
- 実ブラウザでObsidian書き込み権限（host_permissions）が正しく設定されることを確認

## 実装アプローチ
- 単一実装を選定 → 他方を委譲/再エクスポート → ポート定数の一元化 → テスト追加
- 段階的: まずポートバグを特定・修正 → 次に二重実装を統合

## 見積もり
1pt（ポートバグ修正 + 二重実装統合 + テスト追加）

## 技術的考慮事項
- 依存: `src/utils/storage/settingsStore.ts`, `src/utils/allowedUrls.ts`, `src/utils/storage.ts`, `src/utils/storageUrls.ts`, `src/utils/storage/defaults.ts`
- `allowedUrls.ts` は独立モジュールで import 先が限定的なため、`settingsStore.ts` の実装を正とし `allowedUrls.ts` を再エクスポートに寄せるのが低リスク
- `saveSettingsWithAllowedUrls` は `settingsStore` 版が `updateDomainFilterCache` を呼ぶ点が正。他方の薄い版は統合対象

## 関連
- コードレビューレポート: 本セッションの重複レビュー（Cluster: buildAllowedUrls 重複 / ポート不一致）
- 対象ファイル: `src/utils/storage/settingsStore.ts`, `src/utils/allowedUrls.ts`, `src/utils/storage.ts`, `src/utils/storageUrls.ts`, `src/utils/storage/defaults.ts`
