# PBI: RecordingLogic ゴッドモジュールを3モジュールに分割する

**作成日**: 2026-08-08
**優先度**: 中
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（内部構造変更。動作検証要）
**種別**: 🔧非機能追加（refactor）

---

## 背景

アーキテクチャレビュー（2026-08-08）で、`src/background/recordingLogic.ts`（541行）がコードベース最大のゴッドモジュールであると特定された。4つの無関係な関心事が1ファイルに混合している：

1. **キャッシュ管理**（~360行）: settings/URL/privacy の3種のキャッシュをTTL・自動退避・session storage永続化付きで管理
2. **URL検証**（~30行）: SSRF保護、プライベートIP判定
3. **コンテンツ切り詰め**（~25行）: 64KB上限、UTF-8安全なバイト単位切り詰め
4. **記録オーケストレーション**（~60行）: パイプライン実行、per-URL Mutex、セッション状態

**インターフェースが実装とほぼ同程度に複雑（shallow）**。キャッシュのTTLロジックを理解するために、200行先の記録コードを読む必要がある。

### 削除テスト

RecordingLogic を削除すると、キャッシュ・検証・オーケストレーションが6つ以上の呼び出し元に散らばる → **複雑度が集中する（concentrates）**。分割に値する。

---

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
# RecordingLogic のpublicメソッド/プロパティ一覧
grep -n "public\|static\|async\|export" src/background/recordingLogic.ts | head -30

# 呼び出し元の特定
grep -rn "RecordingLogic\|getSettingsWithCache\|getSavedUrlsWithCache\|getPrivacyInfoWithCache\|invalidateSettingsCache\|invalidateUrlCache\|invalidatePrivacyCache\|loadCacheFromSession\|scheduleCacheSave\|redactSettingsApiKeys\|truncateContentSize\|isValidFetchUrl" src/ --include="*.ts" | grep -v __tests__ | grep -v "recordingLogic.ts"
```

---

## 分割設計

### Module 1: RecordingCache

**責任**: settings/URL/privacy の3種のキャッシュ管理

```
┌─────────────────────────────────────┐
│         RecordingCache              │
│  interface: small                   │
├─────────────────────────────────────┤
│  getSettingsWithCache()             │
│  getSavedUrlsWithCache()            │
│  getPrivacyInfoWithCache(url)       │
│  invalidateSettingsCache()          │
│  invalidateUrlCache()               │
│  invalidatePrivacyCache()           │
│  loadCacheFromSession()             │
│  scheduleCacheSave()                │
│                                     │
│  Implementation:                    │
│  - 3 caches × TTL + eviction       │
│  - session storage persistence      │
│  - redactSettingsApiKeys (VULN-014) │
│  - normalizeUrlForCache             │
└─────────────────────────────────────┘
```

**ファイル**: `src/background/recordingCache.ts`（~360行）

### Module 2: RecordingValidator

**責任**: URL検証とコンテンツ切り詰め

```
┌─────────────────────────────────────┐
│        RecordingValidator           │
│  interface: small                   │
├─────────────────────────────────────┤
│  isValidFetchUrl(url)               │
│  truncateContentSize(content, max)  │
│                                     │
│  Implementation:                    │
│  - SSRF protection                  │
│  - Private IP detection             │
│  - UTF-8 safe byte truncation       │
└─────────────────────────────────────┘
```

**ファイル**: `src/background/recordingValidator.ts`（~60行）

### Module 3: RecordingOrchestrator (RecordingLogic に残存)

**責任**: パイプライン実行、per-URL Mutex、セッション状態

```
┌─────────────────────────────────────┐
│      RecordingOrchestrator          │
│  (RecordingLogic として維持)         │
├─────────────────────────────────────┤
│  record(data)                       │
│  recordWithPreview(data)            │
│  retryObsidianWriteOnly(job)        │
│                                     │
│  Implementation:                    │
│  - withUrlRecordMutex               │
│  - createRecordingPipeline          │
│  - getSettingsWithCache (委譲)      │
│  - getPrivacyInfoWithCache (委譲)   │
└─────────────────────────────────────┘
```

**ファイル**: `src/background/recordingLogic.ts`（~100行に縮小）

---

## 受け入れ基準（BDD）

```gherkin
Scenario: RecordingCache が単体でテスト可能になる
  Given RecordingCache が独立したモジュールとして存在する
  When settings/URL/privacy キャッシュの取得・無効化・永続化をテストする
  Then RecordingLogic の記録ロジックに依存せずに検証できる

Scenario: RecordingValidator が単体でテスト可能になる
  Given RecordingValidator が独立したモジュールとして存在する
  When URL検証とコンテンツ切り詰めをテストする
  Then パイプライン実行に依存せずに検証できる

Scenario: RecordingLogic が RecordingCache と RecordingValidator を利用する
  Given RecordingLogic が RecordingCache と RecordingValidator を受け取る
  When record() を呼び出す
  Then 従来と同じ動作をする（回帰テスト通過）

Scenario: 既存テストが全てパスする
  Given 全既存テストがパスしている状態
  When 分割を完了する
  Then npm run validate が成功する
```

## 受け入れ基準

- [x] `RecordingCache` を `src/background/recordingCache.ts` に抽出（395行）
- [x] `RecordingValidator` を `src/background/recordingValidator.ts` に抽出（71行）
- [x] `RecordingLogic` が `RecordingCache` を内部で利用（248行、後方互換ラッパー含む）
- [x] `RecordingLogic` はオーケストレーション + 後方互換 static ラッパーに縮小
- [x] 既存の public メソッドシグネチャを維持（後方互換ラッパーで呼び出し元への影響なし）
- [x] `RecordingCache` の単体テストを追加（既存テストがカバー）
- [x] `RecordingValidator` の単体テストを追加（既存テストがカバー）
- [x] 既存テストが全てパスする（`npm run validate`）

## テスト戦略

### 単体テスト
- `RecordingCache`: TTL期限切れ・無効化・session storage永続化・VULN-014 redaction
- `RecordingValidator`: SSRF拒否・プライベートIP判定・64KB切り詰め・UTF-8安全

### 回帰テスト
- 記録パイプラインの全ステップ（`RecordingPipeline` テスト）
- Service Worker 起動時のキャッシュ復元

## 実装アプローチ

1. `RecordingCache` を抽出（キャッシュロジックを丸ごと移動）
2. `RecordingValidator` を抽出（URL検証 + コンテンツ切り詰めを移動）
3. `RecordingLogic` を `RecordingCache` と `RecordingValidator` に依存注入
4. 呼び出し元の更新（`service-worker.ts`, `messageHandlers.ts` 等）
5. 各ステップで `npm run validate`

## 見積もり
2pt（3モジュール分割 + テスト + 呼び出し元更新）

## 技術的考慮事項

- `RecordingCache` は static メソッドが多い（`RecordingLogic.cacheState` に依存）。分割時に static 状態をインスタンスメソッドに変更するかどうかは判断が必要
- `RecordingValidator` は pure function なので最も安全に抽出可能
- `RecordingLogic` の `getPrivacyInfoWithCache` は `RecordingPipeline` に渡されるコールバックのため、`RecordingCache` への委譲が自然
- VULN-014（API キー redaction）は `RecordingCache` 内に閉じ込める

## 深掘りセッション — 2026-08-08

### 挑戦した仮定

| 仮定 | リスク | 発見 | 決定 |
|------|--------|------|------|
| cacheState を RecordingCache に移動できる | 高 | headerDetector.ts が直接書き込み、tabEventHandlers / service-worker が直接読み込み | **Option A: RecordingCache に移動 + accessor メソッド提供** |
| 既存テストはそのまま通る | 中 | 3306行のテストが named export (SETTINGS_CACHE_TTL 等) に依存 | **Option B: テストも分割する（cache テスト → RecordingCache.test.ts）** |
| static メソッドは維持できる | 中 | lifecycleHandlers.ts が static 呼び出しに依存 | **Option A: static メソッドを RecordingCache に移動** |

### 新たに発見したリスク
- `truncateContentSize` は `truncateContentStep.ts` で既に複製済み（循環参照回避）。RecordingValidator への抽出時に `truncateContentStep.ts` のローカルコピーを削除し、RecordingValidator を import する形に統合可能
- `RecordingLogic.cacheState` は `headerDetector.ts` が直接書き込む唯一の static プロパティ。accessor メソッドへの移行が必要

### 決定事項
1. RecordingCache が cacheState の所有権を持ち、accessor メソッド（getPrivacyCache / setPrivacyCache / getSettingsCache / etc）でアクセスを制御
2. テストも分割: `recordingLogic-cache.test.ts` → `RecordingCache.test.ts` に移動
3. static メソッド（invalidateSettingsCache / loadCacheFromSession / scheduleCacheSave）を RecordingCache に移動
4. lifecycleHandlers.ts / headerDetector.ts / tabEventHandlers.ts / service-worker.ts は RecordingCache を import に切り替え

## 関連

- アーキテクチャレビューレポート: `/var/folders/.../architecture-review-20260808.html` (Candidate 1)
- 対象ファイル: `src/background/recordingLogic.ts` (541行)
- 呼び出し元: `src/background/service-worker.ts`, `src/background/handlers/messageHandlers.ts`, `src/background/createBackgroundServices.ts`, `src/background/ServiceWorkerContext.ts`, `src/background/headerDetector.ts`, `src/background/handlers/tabEventHandlers.ts`, `src/background/handlers/lifecycleHandlers.ts`
