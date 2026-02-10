# ドメインロジック改善 - 実装計画

**作成日**: 2026-02-10
**バージョン**: 1.0.0
**ステータス**: 設計完了・実装待ち

## 概要

Chrome Extension「Obsidian Smart History」における5つのドメインロジック改善を実装します。各改善は独立したモジュールとして実装し、既存コードへの影響を最小化します。

## 改善項目

1. **Service Worker未対応時の再試行ロジック**
2. **スクロール深度計算の境界条件改善**
3. **設定インポート時の厳密なバリデーション**
4. **オフライン時のキューイング機能**
5. **Read-Modify-Writeの競合に対する楽観的ロック**

---

## アーキテクチャ概要

### 実装アプローチ

**段階的実装**を採用し、各改善を独立したモジュールとして実装します。

### 新規作成するモジュール

1. **`src/utils/retryHelper.js`**
   - Service Workerへのメッセージ送信リトライ機能
   - 指数バックオフ（exponential backoff）を実装
   - 最大リトライ回数: 3回、初期遅延: 100ms

2. **`src/utils/offlineQueue.js`**
   - IndexedDBベースのオフラインキュー管理
   - データベース名: `obsidian-smart-history-queue`
   - オンライン復帰検出とバックグラウンド同期

3. **`src/utils/optimisticLock.js`**
   - バージョンベースの楽観的ロック実装
   - `chrome.storage.local`にバージョン番号を保存
   - 競合検出時の自動リトライ（最大5回）

4. **`src/content/scrollDepthTracker.js`**
   - 動的コンテンツ対応のスクロール深度計算
   - MutationObserverでDOM変更を監視
   - デバウンス処理で計算頻度を制御

### 既存モジュールの拡張

- **`src/utils/settingsExportImport.js`**: バージョン互換性チェック機能を追加
- **`src/background/service-worker.js`**: オフラインキュー統合
- **`src/content/extractor.js`**: 新しいスクロール深度トラッカーを統合

### 依存関係

```
offlineQueue.js → retryHelper.js（キュー処理時のリトライ）
recordingLogic.js → optimisticLock.js（URL保存時のロック）
extractor.js → scrollDepthTracker.js（スクロール深度判定）
```

---

## 詳細設計

### 1. retryHelper.js（リトライヘルパー）

#### 目的
Content ScriptやPopupからService Workerへのメッセージ送信失敗時に、自動的にリトライする機能を提供します。

#### 主要な関数

**`sendMessageWithRetry(message, options)`**
- **パラメータ**:
  - `message`: 送信するメッセージオブジェクト
  - `options`: `{ maxRetries: 3, initialDelay: 100, backoffMultiplier: 2 }`
- **動作**:
  1. `chrome.runtime.sendMessage()`を実行
  2. エラー発生時（Service Worker未起動など）、指数バックオフで再試行
  3. 各リトライ前に遅延: `delay = initialDelay * (backoffMultiplier ^ retryCount)`
  4. 最大リトライ回数に達したら最終エラーを返す

**`isRetryableError(error)`**
- **リトライ可能なエラーを判定**:
  - `"Could not establish connection"`（Service Worker未起動）
  - `"Extension context invalidated"`（拡張機能再読み込み中）
  - その他の一時的なエラー
- **リトライ不可能なエラー**（無効なメッセージ形式など）はすぐに失敗

#### エラーハンドリング
- 最終的に失敗した場合は、オフラインキュー（`offlineQueue.js`）にフォールバック
- コンソールにリトライ状況をログ出力（デバッグ用）

#### テスト戦略
- Service Workerを一時的に停止してリトライをテスト
- モックでエラー条件を再現
- テストファイル: `src/utils/__tests__/retryHelper.test.js`

---

### 2. offlineQueue.js（オフラインキュー）

#### 目的
ネットワーク障害やService Worker未起動時に記録リクエストをIndexedDBに保存し、オンライン復帰時に自動的に再送信します。

#### IndexedDB構造
- **データベース名**: `obsidian-smart-history-queue`
- **バージョン**: 1
- **オブジェクトストア**: `pendingRecords`
  - キー: 自動インクリメントID
  - インデックス: `timestamp`（古い順に処理）
  - レコード構造:
    ```javascript
    {
      id: 1,
      timestamp: 1234567890,
      data: { title, url, content, force, skipDuplicateCheck },
      retryCount: 0,
      lastError: null
    }
    ```

#### 主要な関数

**`enqueue(recordData)`**
- 記録リクエストをキューに追加
- タイムスタンプを自動付与
- 最大キューサイズ: 100件（超過時は古いものを削除）

**`processQueue()`**
- キュー内のすべてのレコードを順番に処理
- 各レコードを`retryHelper.sendMessageWithRetry()`で送信
- 成功したレコードはキューから削除
- 失敗したレコードは`retryCount`をインクリメント（最大3回まで保持）

**`startAutoSync()`**
- `navigator.onLine`イベントを監視
- オンライン復帰時に自動的に`processQueue()`を実行
- Service Worker起動時にも自動実行

#### テスト戦略
- オフライン状態をシミュレート（`navigator.onLine = false`）
- IndexedDBのモックを使用
- テストファイル: `src/utils/__tests__/offlineQueue.test.js`

---

### 3. optimisticLock.js（楽観的ロック）

#### 目的
`getSavedUrls()` → 更新 → `setSavedUrls()`の間に他の処理が割り込んで競合が発生した場合、自動的に検出して再試行します。

#### ストレージ構造
`chrome.storage.local`に新しいキーを追加:
- **`savedUrls_version`**: バージョン番号（整数、初期値0）
- 更新のたびにインクリメント

#### 主要な関数

**`withOptimisticLock(key, updateFn, options)`**
- **パラメータ**:
  - `key`: ロック対象のストレージキー（例: `'savedUrls'`）
  - `updateFn`: 更新関数 `(currentValue) => newValue`
  - `options`: `{ maxRetries: 5, retryDelay: 50 }`
- **動作**:
  1. 現在の値とバージョン番号を取得
  2. `updateFn(currentValue)`を実行して新しい値を計算
  3. バージョン番号が変わっていないか確認
  4. 変わっていなければ、新しい値とバージョン+1を保存
  5. 変わっていれば競合と判断し、1からやり直し

**実装例（URLセットの更新）**:
```javascript
await withOptimisticLock('savedUrls', (currentUrls) => {
  const urlSet = new Set(currentUrls);
  urlSet.add(newUrl);
  return Array.from(urlSet);
});
```

#### エラーハンドリング
- 最大リトライ回数を超えた場合は`ConflictError`をスロー
- ログに競合検出回数を記録（パフォーマンス監視用）

#### 既存コードへの統合
- `storage.js`の`setSavedUrls()`を内部で`withOptimisticLock()`を使うように変更
- `recordingLogic.js`は変更不要（透過的に動作）

#### テスト戦略
- 並行アクセスをシミュレート
- テストファイル: `src/utils/__tests__/optimisticLock.test.js`

---

### 4. scrollDepthTracker.js（スクロール深度トラッカー）

#### 目的
動的にコンテンツが追加されるページ（無限スクロール、遅延ロードなど）でも正確なスクロール深度を計算します。

#### 主要な機能

**`ScrollDepthTracker`クラス**
- コンストラクタで`minScrollDepth`（しきい値）を受け取る
- ページロード後、継続的にスクロール深度を監視

**`startTracking()`**
- MutationObserverでDOM変更を監視
  - 監視対象: `document.body`の`childList`, `subtree`
  - DOM変更時にページ高さを再計算
- スクロールイベントをリッスン
  - デバウンス処理: 200ms（頻繁な計算を防ぐ）
- 定期チェック: 5秒ごとに深度を再評価（フォールバック）

**`getCurrentDepth()`**
- 現在のスクロール深度をパーセンテージで返す
- 計算式:
  ```javascript
  const scrollTop = window.scrollY;
  const windowHeight = window.innerHeight;
  const documentHeight = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight
  );
  const scrollableHeight = documentHeight - windowHeight;
  return scrollableHeight > 0 ? (scrollTop / scrollableHeight) * 100 : 100;
  ```

**`hasReachedThreshold()`**
- しきい値に到達したかを判定
- 一度到達したらフラグを立てて、以降の計算を省略（パフォーマンス最適化）

**`stopTracking()`**
- MutationObserver、イベントリスナー、タイマーをすべて解除

#### 既存コードへの統合
- `src/content/extractor.js`で`ScrollDepthTracker`をインスタンス化
- ページロード時に`startTracking()`を呼び出し
- 記録判定時に`hasReachedThreshold()`をチェック

#### テスト戦略
- jsdomで動的コンテンツ追加をシミュレート
- テストファイル: `src/content/__tests__/scrollDepthTracker.test.js`

---

### 5. settingsExportImport.js（互換性チェック拡張）

#### 目的
異なるバージョン間での設定インポート時に、互換性を保ち、不明なキーを適切に処理します。

#### 新機能の追加

**バージョン管理の強化**
- 現在の`EXPORT_VERSION`を`'1.0.0'`から変更可能な構造に
- セマンティックバージョニング（major.minor.patch）に対応

**`migrateSettings(importedSettings, fromVersion, toVersion)`**
- バージョン間の設定マイグレーション関数
- 例: v1.0.0 → v1.1.0でキー名が変更された場合の変換
- マイグレーション履歴を配列で管理:
  ```javascript
  const migrations = [
    {
      from: '1.0.0',
      to: '1.1.0',
      migrate: (settings) => {
        // 古いキー名を新しいキー名に変換
        if ('old_key' in settings) {
          settings['new_key'] = settings['old_key'];
          delete settings['old_key'];
        }
        return settings;
      }
    }
  ];
  ```

**`validateAndSanitizeSettings(settings)`**
- 既存の`validateExportData()`を拡張
- 不明なキーの処理:
  - デフォルト: 警告を表示して無視
  - オプション: 保持する（将来のバージョンで使用される可能性）
- デフォルト値へのフォールバック:
  - 必須キーが欠けている場合、`DEFAULT_SETTINGS`から補完
  - 配列型フィールドが`null`の場合、空配列`[]`に変換

**`importSettings(jsonData)`の更新**
- バージョンチェック後、`migrateSettings()`を呼び出し
- マイグレーション後、`validateAndSanitizeSettings()`で検証
- インポート結果のサマリーをログ出力:
  - マイグレーション適用の有無
  - 無視された不明なキーのリスト
  - 補完されたデフォルト値

#### テスト戦略
- 古いバージョンの設定ファイルでインポートテスト
- 不明なキーを含むファイルでの動作確認
- テストファイル: `src/utils/__tests__/settingsExportImport-migration.test.js`

---

## 実装順序

推奨される実装順序（依存関係を考慮）：

1. **Phase 1: 基礎機能**
   - `retryHelper.js` + テスト
   - `optimisticLock.js` + テスト
   - `storage.js`への楽観的ロック統合

2. **Phase 2: オフライン対応**
   - `offlineQueue.js` + テスト
   - `service-worker.js`へのキュー統合
   - Content Script/Popupでの`retryHelper`統合

3. **Phase 3: スクロール深度**
   - `scrollDepthTracker.js` + テスト
   - `extractor.js`への統合

4. **Phase 4: 設定互換性**
   - `settingsExportImport.js`の拡張 + テスト
   - マイグレーション関数の実装

5. **Phase 5: 統合テスト**
   - 各機能の統合テスト
   - E2Eテスト
   - パフォーマンステスト

---

## テスト戦略

### ユニットテスト
- 各新規モジュールに対応するテストファイルを作成
- Jestとjsdomを使用
- カバレッジ目標: 80%以上

### 統合テスト
- `src/background/__tests__/integration-domain-logic.test.js`
- オフラインキュー + リトライの連携テスト
- 楽観的ロック + 並行アクセステスト

### E2Eテスト
- 実際のChrome拡張機能環境でテスト
- オフライン/オンライン切り替えシナリオ
- 動的コンテンツページでのスクロール深度テスト

---

## パフォーマンス考慮事項

### メモリ使用量
- オフラインキュー: 最大100件のレコード（約1MB）
- スクロール深度トラッカー: MutationObserverのデバウンス（200ms）

### CPU使用量
- 楽観的ロック: 競合時のリトライコスト（通常は1-2回）
- スクロール深度: 5秒ごとの定期チェック（バックグラウンド）

### ストレージ
- IndexedDB: オフラインキュー専用（最大10MB想定）
- chrome.storage.local: バージョン番号追加（数バイト）

---

## ロールバック戦略

各モジュールは独立しているため、問題が発生した場合は個別にロールバック可能です：

1. **機能フラグの導入**（オプション）
   - `chrome.storage.local`に機能有効化フラグを保存
   - 問題発生時は管理画面から無効化可能

2. **段階的ロールアウト**
   - まず開発版で十分にテスト
   - 本番環境へは1機能ずつリリース

---

## セキュリティ考慮事項

### IndexedDB
- オフラインキューに保存されるデータは機密情報を含む可能性
- PII sanitization後のコンテンツのみ保存
- キューサイズ制限でDoS攻撃を防止

### 楽観的ロック
- バージョン番号の改ざん対策は不要（ローカルストレージのみ）
- 競合ログに個人情報を含めない

---

## 今後の拡張性

### 追加機能の候補
- オフラインキューの優先度管理
- 楽観的ロックのメトリクス収集
- スクロール深度の機械学習ベース判定

### 互換性維持
- 設定マイグレーション機構により、将来のバージョンアップに対応
- 新しいストレージキーは既存のキーと衝突しないよう命名規則を統一

---

## まとめ

この実装計画により、以下の改善が実現されます：

1. ✅ **信頼性向上**: Service Worker未起動時の自動リトライ
2. ✅ **精度向上**: 動的コンテンツ対応のスクロール深度計算
3. ✅ **堅牢性向上**: 設定インポート時の互換性チェック
4. ✅ **可用性向上**: オフライン時のキューイング機能
5. ✅ **データ整合性**: Read-Modify-Write競合の自動検出と再試行

各モジュールは独立しており、テストとデバッグが容易な設計となっています。段階的な実装により、リスクを最小化しながら確実に品質を向上させることができます。
