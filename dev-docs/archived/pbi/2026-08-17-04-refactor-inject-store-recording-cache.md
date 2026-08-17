# PBI: RecordingCache にストアを注入可能にする

## ユーザーストーリー
開発者として、`RecordingCache` が持つモジュールレベルのシングルトン状態を、コンストラクタまたはファクトリ経由で注入可能な store に置き換えたい。なぜなら、静的メソッドとモジュールスコープ状態はテスト間で漏洩し、モックが困難で保守性を損なっているから。

## ビジネス価値
- テスト間の状態漏洩を排除し、再現性の高いユニットテストが書けるようになる
- 本番とテストで異なるストレージバックエンドを注入できる柔軟性を得る
- `RecordingCache` から静的メソッド脱却し、オブジェクト指向の責務を明確にする

## BDD受け入れシナリオ

```gherkin
Scenario: テストでの独立したキャッシュ
  Given テスト A でキャッシュにプライバシー情報を設定する
  When 別のテスト B を新しい injected store で実行する
  Then テスト B はテスト A のキャッシュを参照しない

Scenario: SW 再起動後のキャッシュ復元
  Given 本番環境で session ストアが RecordingCache に注入されている
  When Service Worker が再起動する
  Then 注入された store からキャッシュ状態が復元される
  And 設定キャッシュの TTL が継続して機能する

Scenario: 設定 TTL 切れ
  Given 設定キャッシュに古い値が入っている
  When 取得時に TTL を超過していると判定される
  Then store は stale 状態を示し、fetchAndCacheSettings で再取得される
```

## 受け入れ基準
- [ ] `RecordingCache` が store をコンストラクタまたはファクトリ引数で受け取る
- [ ] 既存の static メソッドを呼び出しているコードは、デフォルトの module-level インスタンスを経由して動作し続ける
- [ ] `SessionStore` 経由の復元処理が注入された store に委譲されている
- [ ] テストで in-memory store を注入できる
- [ ] 既存の `recordingCache` テストがすべてパスする
- [ ] 静的メソッドを持たない新しい public API が追加されている（既存 static は非推奨化または削除）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- Service Worker 再起動後の自動記録シナリオが従来通り動作する

### 統合テスト
- `RecordingCache` + `SessionStore` の復元フロー
- `createBackgroundServices` からの注入経路

### 単体テスト
- injected in-memory store を使った settings/url/privacy キャッシュの TTL 動作
- `redactSettingsApiKeys` のセマンティクス維持
- API key を含む設定の保存時に session store に redact されたコピーが保存される
- 状態リセットの独立性

## 実装アプローチ
- **Outside-In**: `createBackgroundServices` から `RecordingCache` インスタンスを生成し、呼び出し元に渡す
- **Red-Green-Refactor**: store interface を定義 → 既存 static 実装を instance method に移行 → 既存呼び出しをデフォルトインスタンス経由に変更

## 見積もり
3ポイント

## 技術的考慮事項
- 依存関係: `src/background/sessionStore.ts`、`src/utils/storage.ts`、`src/utils/storage/settingsStore.ts`、`src/background/headerDetector.ts`、`src/background/handlers/tabEventHandlers.ts`、`src/background/service-worker.ts`
- テスタビリティ: store interface は `get`/`set`/`remove` の最小限にし、非同期を許容する
- 副作用: `headerDetector` / `tabEventHandlers` / `service-worker` は `RecordingCache` の static method を直接呼んでいる。移行時にこれらの呼び出し元を修正する必要がある

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "RecordingCache\." src/
grep -rn "from.*recordingCache" src/
```

### 推奨構成
```typescript
// src/background/recordingCache.ts
export interface RecordingCacheStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export class RecordingCache {
  constructor(private readonly store: RecordingCacheStore) {}
  // instance methods
}

// 既存呼び出し向けデフォルトインスタンス
export const defaultRecordingCache = new RecordingCache(new SessionStoreRecordingCacheStore());
```

### 実装手順
1. `RecordingCacheStore` interface を定義する
2. `SessionStore` をラップした `SessionStoreRecordingCacheStore` を実装する
3. `RecordingCache` を class instance に移行し、static メソッドは instance method にする
4. 既存の static accessor を `defaultRecordingCache` に委譲する thin wrapper として残す（非推奨化）
5. `createBackgroundServices` から `RecordingCache` インスタンスを生成し、必要な handler に注入
6. テストで in-memory store を注入する

### 落とし穴
- `RecordingCache.getCacheState()` はテストから内部的に参照されている可能性がある。`defaultRecordingCache.getCacheState()` 経由に変更する
- `SessionStore` への保存は非同期だが、既存の static setter は同期的に in-memory state を更新している。store 書き込みは非同期で行い、整合性に注意する
- `redactSettingsApiKeys` はそのまま utility として維持する
- `API_KEY_FIELDS` は `settingsStore` から import するまま

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] 既存テストがすべてパスする
- [ ] injected store を使った単体テストが追加されている
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み（必要に応じて）
