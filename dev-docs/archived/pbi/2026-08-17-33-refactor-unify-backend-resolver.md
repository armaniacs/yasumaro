# PBI: バックエンド選定を単一の BackendResolver に一元化する

## ユーザーストーリー
開発者として、OPFS → IDB → Fallback → None というバックエンド優先順位が `ensureBackend()` と `getBackend()` に重複実装され、一方で `opfsCapabilities.detectLiveVfsStrategy()` が診断パネル専用で lifecycle に未接続な状態を解消したい。なぜなら、VFS 検出が2系統に分かれてドリフトするリスクがあり、バックエンド選定が単独でテストできないから。

## ビジネス価値
- バックエンド優先順位を1モジュールに集約し、選定ロジックのドリフトを排除する
- 診断パネルが「実際の選定」と同一の検出結果を表示する
- 機能検出を注入可能にし、バックエンド選定を隔離して単体テストできる

## BDD受け入れシナリオ

```gherkin
Scenario: バックエンド選定が1箇所で行われる
  Given BackendResolver がバックエンド優先順位を所有する
  When ensureBackend と getBackend がバックエンドを決定する
  Then どちらも BackendResolver を参照する
  And 優先順位の重複実装が存在しない

Scenario: 機能検出が lifecycle と診断で共有される
  Given opfsCapabilities の検出結果が BackendResolver に注入されている
  When 診断パネルが VFS 戦略を表示する
  Then lifecycle が使うのと同じ検出結果を表示する

Scenario: 全バックエンドが利用不可の場合
  Given OPFS と IDB の両方が利用不可である
  When BackendResolver がバックエンドを解決する
  Then Fallback または Noop を返す
  And 例外を投げない
```

## 受け入れ基準
- [ ] `BackendResolver` モジュールが新設され、OPFS > IDB > Fallback > None の優先順位を唯一の場所で所有する
- [ ] `ensureBackend()` と `getBackend()`（`sqliteEngineContext.ts:176-236`）が `BackendResolver` を参照し、優先順位の重複実装が無い
- [ ] `opfsCapabilities.detectLiveVfsStrategy()` が `BackendResolver` に接続されている
- [ ] 診断パネルと lifecycle が同一の検出結果を使う
- [ ] 既存の SQLite 関連テストがすべてパスする
- [ ] `npm run validate` が通過している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 既存のE2Eシナリオ（OPFS / IDB / Fallback 各環境）がパスすることを確認

### 統合テスト
- `BackendResolver` を介したバックエンド選択フロー（OPFS → IDB → Fallback → None）

### 単体テスト
- `BackendResolver`: 機能検出を注入した4パターン（OPFS あり / OPFS なし IDB あり / 両方なし / フォールバックのみ）
- 機能検出プローブをモックした優先順位の分岐テスト

## 実装アプローチ
- **Outside-In**: まず `BackendResolver` の失敗するテストを書き、`ensureBackend`/`getBackend` を委譲に書き換えてグリーン化
- **Red-Green-Refactor**: 重複した優先順位ロジックを削除し、型エラーを逐次解消

## 見積もり
2ポイント

## 技術的考慮事項
- 依存関係: PBI-01（sqliteEngineContext 分割）の分割はコードに反映済み（`sqliteEngineContext/` 配下にモジュールが存在）。この PBI はその上に積む形で独立して実装可能
- テスタビリティ: 機能検出（`opfsCapabilities`）を注入可能にして、バックエンド選定を隔離テストする
- 副作用: バックエンド選定の挙動は不変（優先順位は現行と同じ）。動作変更は許容しない

## 実装者向け注記

### 現状コードの確認
```bash
# 重複した優先順位ロジックを確認
sed -n '176,236p' src/offscreen/sqliteEngineContext.ts
# opfsCapabilities の利用箇所を確認（診断パネル専用か）
grep -rn "detectLiveVfsStrategy\|opfsCapabilities" src/ --include="*.ts" | grep -v __tests__
# 現行の検出方法を確認
grep -rn "getDirectory\|isOpfsAvailable" src/offscreen/sqliteEngineContext/opfsWorkerProxy.ts
```

### 現状（2026-08-17 確認済み）
- `sqliteEngineContext.ts:176-191`（`ensureBackend`）と `193-236`（`getBackend`）が同じ OPFS > IDB > Fallback 優先順位を独立に実装している
- `opfsCapabilities.ts:66` の `detectLiveVfsStrategy()` は `diagnosticsPanel.ts:334` と `opfsSpike.ts:12` でのみ使われ、lifecycle（`_doInit`/`getBackend`）には未接続
- `opfsWorkerProxy.ts` の `isOpfsAvailable()` は `typeof navigator?.storage?.getDirectory` のアドホック判定を行っており、`opfsCapabilities` と二重の検出系が存在する
- 既実装の重複: なし（この PBI は未実装。PBI-01 はファイル分割であり、選定ロジックの一元化は対象外）

### 実装手順
1. `src/offscreen/backendResolver.ts` を新設し、`resolveBackend(caps)` が OPFS > IDB > Fallback > None を返す純ロジックを実装
2. `opfsCapabilities.detectLiveVfsStrategy()` の結果を `BackendResolver` に渡す形にし、`opfsWorkerProxy.isOpfsAvailable()` のアドホック判定を置き換え
3. `ensureBackend()` / `getBackend()` を `BackendResolver` への委譲に書き換え、重複した優先順位分岐を削除
4. 診断パネルが `BackendResolver` 経由の検出結果を表示するよう更新
5. 機能検出を注入可能にし、単体テストを追加

### 落とし穴
- `getBackend()` は `_backend` をキャッシュし、動的 import（`OpfsWorkerBackend` / `IdbVfsBackend` / `FallbackStorageAdapter`）でアダプタを生成する。この生成責務は resolver に持たせず、選定結果（タグ）と生成を分離すること
- `_doInit()` は「OPFS 初期化 → マイグレーションバックアップ → IDB 初期化 → 復元 → フォールバック移行」という副作用付きの順序を持つ。`BackendResolver` は「選定」だけを担当し、この初期化順序は壊さないこと
- `opfsCapabilities.detectLiveVfsStrategy()` は例外を投げ得る（`diagnosticsPanel.ts:336` の try/catch 参照）。resolver 側でフォールバックを保証する
- 診断パネルと lifecycle で検出結果を共有すると、診断表示が lifecycle の初期化状態に依存しないよう、検出は純関数のまま保つこと

## Definition of Done
- [ ] `BackendResolver` が優先順位を唯一の場所で所有している
- [ ] `ensureBackend()` / `getBackend()` の優先順位重複が解消されている
- [ ] `opfsCapabilities` が lifecycle に接続されている
- [ ] 診断パネルと lifecycle が同一の検出結果を使う
- [ ] 全テストがパスし `npm run validate` が通過している
- [ ] コードレビュー完了
