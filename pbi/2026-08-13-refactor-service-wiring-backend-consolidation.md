# PBI: サービス配線・StorageBackend・設定表示の統合候補を整理する

**作成日**: 2026-08-07
**優先度**: 低
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（内部構造変更。動作検証要）
**種別**: 🔧非機能追加（refactor）

---

## 背景

コードレビューで、構造的に類似し将来の統合候補となる実装ペアが複数発見された。単発のバグではなく「保守性のための統合候補」のため、本PBIでまとめて扱う。独立性が高い場合は分割を検討する。

### 統合候補

**1. AIプロバイダ設定表示の重複（~60行）**

| ファイル | 関数 |
|---------|------|
| `popup/settings/aiProvider.ts` | `updateAIProviderVisibility`, `updateAIProviderVisibilityMulti`（150行） |
| `dashboard/aiProviderLayoutManager.ts` | `updateProviderSettingsLayout`, `hideAllProviderSettings`（96行） |

同一の7プロバイダ設定セクションの表示/非表示を2箇所で実装。

**2. サービス配線の重複（~40行）**

| ファイル | 内容 |
|---------|------|
| `background/ServiceWorkerContext.ts` | `TabCache`, `RateLimiter`, `AIClient`, `ObsidianClient`, `SqliteClient`, `RecordingLogic` を構築 |
| `background/createBackgroundServices.ts` | 同一サービスの構築・ラッピング |

両方が `service-worker.ts` の現役パス。

**3. StorageBackend interface の再宣言（各15-20行）**

| ファイル |
|---------|
| `offscreen/IdbVfsBackend.ts` |
| `offscreen/OpfsWorkerBackend.ts` |
| `offscreen/FallbackStorageAdapter.ts` |

各々が `StorageBackend` の~20メソッドを再宣言する転送ボイラープレートを持つ。

**4. エラー処理イディオムの散在（1-3行×約10ファイル）**

- インライン `error instanceof Error ? error.message : String(error)` が ~10 ファイル（`errorMessage()` を使うべき）
- `Promise.race` + `setTimeout` のリクエストタイムアウトパターンが複数ファイル（`utils/fetch.ts` に共通化済みだが、dashboard/popup の send-message 変種は再利用していない）

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -rn "updateAIProviderVisibility\|updateProviderSettingsLayout" src/popup/settings/aiProvider.ts src/dashboard/aiProviderLayoutManager.ts
grep -rn "new TabCache\|new RateLimiter\|new AIClient\|new ObsidianClient\|new SqliteClient\|new RecordingLogic" src/background/ServiceWorkerContext.ts src/background/createBackgroundServices.ts
grep -rn "StorageBackend" src/offscreen/*.ts | grep "implements"
grep -rn "instanceof Error ? error.message : String" src/ --include="*.ts" | grep -v __tests__ | wc -l
grep -rn "Promise.race" src/dashboard src/popup src/background --include="*.ts" | grep -v __tests__
```

## 受け入れ基準（BDD）

```gherkin
Scenario: プロバイダ設定表示ロジックが共通化される
  Given popup と dashboard が同一の表示切替を実装する状態
  When プロバイダ設定の表示/非表示を切り替える
  Then 両方で同一の共通ロジックが使われる

Scenario: サービス構築が単一の構成関数に集約される
  Given ServiceWorkerContext と createBackgroundServices が同一サービスを構築する状態
  When サービスワーカーが起動する
  Then 単一の構成パスで全サービスが構築される

Scenario: StorageBackend の転送コードが共通化される
  Given 3つのバックエンドが同一 interface を実装する状態
  When バックエンドを切り替える
  Then 共通の委譲基底でメソッドが転送される
```

## 受け入れ基準
- [ ] プロバイダ設定表示ロジックを共通モジュールに抽出（popup/dashboard 双方から利用）
- [ ] サービス構築を単一の構成関数に統合（`ServiceWorkerContext` と `createBackgroundServices` の重複を除去）
- [ ] `StorageBackend` の共通委譲基底クラスを作成し、3バックエンドのボイラープレートを削減
- [ ] エラー処理イディオム（`errorMessage()` 利用、`Promise.race` タイムアウト）の散在を一部共通化
- [ ] 既存テストが全てパスする

## テスト戦略

### 単体テスト
- 抽出した共通ロジック（設定表示切替、サービス構築、StorageBackend委譲）の単体テスト

### 回帰テスト
- サービスワーカー起動、プロバイダ設定表示、SQLiteバックエンド切替の動作確認

## 実装アプローチ
- 統合候補ごとに独立して進め、各ステップで `npm run validate`
- 優先度の高い順: プロバイダ設定表示 → サービス配線 → StorageBackend → エラー処理イディオム
- 独立性が高い場合はサブPBIへの分割を検討

## 見積もり
2pt（4つの統合候補の共通化 + テスト）

## 技術的考慮事項
- 依存: `src/popup/settings/aiProvider.ts`, `src/dashboard/aiProviderLayoutManager.ts`, `src/background/ServiceWorkerContext.ts`, `src/background/createBackgroundServices.ts`, `src/offscreen/{IdbVfsBackend,OpfsWorkerBackend,FallbackStorageAdapter}.ts`
- サービス配線の統合は Service Worker 起動パスの中核のため、単独で進め慎重に検証する
- エラー処理イディオムは効果が大きい一方で影響範囲が広い。安全な範囲（`errorMessage()` 統一）から着手し、`Promise.race` タイムアウトは対象を限定

## 関連
- コードレビューレポート: 本セッションの重複レビュー（統合候補ペア）
- 対象ファイル: `src/popup/settings/aiProvider.ts`, `src/dashboard/aiProviderLayoutManager.ts`, `src/background/ServiceWorkerContext.ts`, `src/background/createBackgroundServices.ts`, `src/offscreen/{IdbVfsBackend,OpfsWorkerBackend,FallbackStorageAdapter}.ts`
