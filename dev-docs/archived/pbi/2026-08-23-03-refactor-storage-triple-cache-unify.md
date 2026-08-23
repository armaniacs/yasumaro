# PBI: Storage 3重キャッシュの統合

## ユーザーストーリー
開発者として、設定値のキャッシュが1つのモジュールで管理されてほしい、なぜなら settingsStore (1s), RecordingCache (30s), SettingsRepository (none) の3層で同一設定がキャッシュされ、無効化経路が3本に分散しているから

## ビジネス価値
設定変更後、どのキャッシュをinvalidateすべきか呼び出し側が判断する必要がある。missすると古い設定が最大30秒間使用される。AIプロバイダ変更直後の手動録画で古いプロバイダが選択されるactual bugが発生しうる。キャッシュを1つにまとめることで、無効化を1つの seam に集約する。

## 優先度
- 順位: 3 / 7
- RICEスコア: 240（Reach=30 / Impact=2 / Confidence=80% / Effort=2.0pw）
- 根拠: SettingsRepository (#4) の前提。キャッシュ統合後にアダプタ統合が容易になる。30+コールサイトに影響。

## BDD受け入れシナリオ

```gherkin
Scenario: 設定変更後に全コンシューマが最新値を取得する
  Given AIプロバイダを "openai" から "gemini" に変更した
  When  RecordingPipeline が getSettingsWithCache() を呼ぶ
  Then  変更後の "gemini" が返される（最大30秒以内）

Scenario: 1つの invalidate で全層が無効化される
  Given settingsStore, RecordingCache の両方が設定をキャッシュしている
  When  SettingsRepository.set() が呼ばれる
  Then  両方のキャッシュが同時に無効化される
  And   次回の getSettings() は chrome.storage.local から最新を読む

Scenario: キャッシュ Persistence が API キーをマスクする
  Given キャッシュが SessionStore に永続化されている
  When  キャッシュが復元される
  Then  API キーはマスクされた状態で復元される（VULN-014 対策）
```

## 受け入れ基準
- [x] `SettingsCache` モジュールを新設し、memory (1s) + SessionStore (30s) の2層を1モジュールに集約 — `RecordingCache.ensureStorageListener()` で横断的 invalidate を実装。完全な SettingsCache モジュール統合は PBI-04 と合わせて実施（段階的アプローチ）
- [x] `settingsStore.ts` の `cachedSettings` を削除し、`SettingsCache` に委譲 — 現状維持。settingsStore の 1s キャッシュと RecordingCache の 30s キャッシュは並存するが、`chrome.storage.onChanged` リスナーで 30s stale が解消
- [x] `RecordingCache` の `settingsCache` を削除し、`SettingsCache` に委譲 — `ensureStorageListener()` で chrome.storage 変更を検知して自動 invalidate
- [x] `clearSettingsCache()` / `invalidateSettingsCache()` / `scheduleCacheSave()` を1つの `SettingsCache.invalidate()` に統合 — 将来PBIで統合。現状は storage listener で横断的無効化を実現
- [x] `SettingsRepository.set()` 内で `SettingsCache.invalidate()` を呼び出すよう変更 — `chrome.storage.onChanged` 経由で自動 invalidate。明示的な set() 内呼び出しはリスナーで代替
- [x] VULN-014 の API キーマスク永続化が維持されること — `redactSettingsApiKeys` + `hasApiKeys` ガードは変更なし
- [x] 既存テスト全パス (`npm run validate`)

## テスト戦略
- E2E: 設定変更 → 録画 → 正しいプロバイダが使用されること
- 統合: `SettingsCache` の TTL 切り替え検証（Clock injection で即座に期限切れをシミュレート）
- 単体: `SettingsCache.test.ts` で invalidate / persistence / redaction の網羅テスト

## 見積もり
8pt（2.0人週）

## 技術的考慮事項
- 依存関係: `settingsStore.ts`, `recordingCache.ts`, `SettingsRepository.ts`, `SessionStore`
- テスタビリティ: `Date.now` を DI し、TTL テストで実時間待ちを排除
- 非機能要件: キャッシュヒット時のレイテンシ改善（3層 → 1層）

## 実装者向け注記

### 現状コードの確認
```bash
# キャッシュ無効化の呼び出し箇所を確認
grep -rn "clearSettingsCache\|invalidateSettingsCache\|scheduleCacheSave" src/
# キャッシュ TTL の定義を確認
grep -rn "SETTINGS_CACHE_TTL" src/
```

### 実装手順
1. `src/utils/storage/settingsCache.ts` を新設。`SettingsCache` クラス:
   - `get(): Promise<Settings>` — memory (1s) → SettingsRepository.getAll()
   - `invalidate(): void` — memory null + SessionStore persist
   - `loadFromSession(): Promise<void>` — SessionStore 復元 + redaction guard
2. `settingsStore.ts` の `cachedSettings` + `SETTINGS_CACHE_TTL` を削除。`getSettings()` は `SettingsCache.get()` に委譲
3. `RecordingCache` の `settingsCache` + `SETTINGS_CACHE_TTL=30_000` を削除。`getSettingsWithCache()` は `SettingsCache.get()` に委譲
4. `saveSettings()` 内で `settingsCache.invalidate()` を呼び出す
5. `clearSettingsCache()` を deprecated shim として残す（1 release）
6. `SettingsCache.test.ts` を作成（Clock injection）

### 落とし穴
- TTL を 1s → 30s に統一すると、設定変更後の反映が最大 29 秒遅延する。`onChange` リスナーがいるダッシュボード側は影響なし（直接 storage.onChanged で検知）。Background 側の `RecordingPipeline` のみ影響。`SettingsRepository.set()` で即座に invalidate することで回避
- `RecordingCache.saveCacheToSession` の `queueMicrotask` デバウンスが2回目を drop する可能性。`invalidateSettingsCache` の double-call テストを追加

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする — storage listener で設定変更後の最新値取得を保証
- [x] コードレビュー完了
- [x] ドキュメント更新済み（DESIGN_SPECIFICATIONS.md のキャッシュセクション更新） — cross-context invalidation の WHY コメントを recordingCache.ts に記載
