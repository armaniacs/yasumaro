# PBI: 未使用エクスポートの削除

## ユーザーストーリー
開発者として、未使用のエクスポートを削除したい、なぜならコードの可読性を向上させ、デッドコードを削減できるから

## ビジネス価値
- **コード可読性向上**: 使用されていないエクスポートを削除することで、開発者が理解すべき API 面を削減
- **デッドコード削減**: 不要なコードを削除し、保守コストを低減
- **バンドルサイズ最適化**: Tree-shaking が効かないケースでのバンドルサイズ削減

## BDD受け入れシナリオ

```gherkin
Scenario: 未使用エクスポートを削除してビルドが成功する
  Given コードベースに未使用のエクスポートが存在する
  When  未使用エクスポートを削除する
  Then  npm run build が成功する
  And   npm run validate が成功する

Scenario: 削除後に既存機能が動作し続ける
  Given 未使用エクスポートを削除した状態
  When  拡張機能をビルドして読み込む
  Then  既存の全機能が正常に動作する
  And   テストがすべてパスする
```

## 受け入れ基準
- [ ] knip で検出された未使用エクスポート（82個）を整理
- [ ] 各エクスポートが本当に未使用であることを確認
- [ ] 安全に削除できるものを削除
- [ ] `npm run build` が成功する
- [ ] `npm run validate` (type-check + test) が成功する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 拡張機能のビルドと読み込みが成功することを確認

### 統合テスト
- 既存のユニットテストがすべてパスすることを確認

### 単体テスト
- 削除したエクスポートを import している箇所がないことを確認

## 実装アプローチ
- **Outside-In**: ビルドテストから開始し、失敗を確認してから削除
- **Red-Green-Refactor**: 削除後にテストが失敗しないことを確認
- **リファクタリング**: 削除後に不要な参照を整理

## 見積もり
5pt （高リスク、各エクスポートの役割を慎重に確認する必要がある）

## 技術的考慮事項
- 依存関係: PBI-03（未使用依存パッケージ削除）、PBI-04（未使用ファイル削除）を先に実施することを推奨
- テスタビリティ: ビルドとテストの実行で確認
- 非機能要件: コードベースの整理

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
# knip を実行して未使用エクスポートの一覧を取得
npx knip
```

**確認済み**: knip の結果から、82個の未使用エクスポートが検出されている。

### 未使用エクスポートのカテゴリ分類

**高リスク（削除前に慎重な確認が必要）**:
- 型定義（interface, type）: 外部で使用されている可能性
- 定数: 設定値として使用されている可能性
- 関数: 将来的に使用される可能性

**中リスク**:
- ユーティリティ関数: 他のモジュールで参照されている可能性
- バックエンドハンドラー: メッセージングで使用されている可能性

**低リスク（削除しても安全）**:
- テスト用のヘルパー関数
- 明らかに古いコード

### 実装手順
1. knip の結果を確認し、各エクスポートの役割を調査
2. 削除しても安全なものを特定
3. 安全なものを削除
4. `npm run build` でビルドが成功することを確認
5. `npm run validate` でテストがパスすることを確認
6. 拡張機能を実際に読み込んで動作確認

### 落とし穴
- 型定義（interface, type）は外部で使用されている可能性が高い。削除前に `grep -rn "TypeName" src/` で確認
- 定数は設定値として使用されている可能性。削除前に `grep -rn "CONSTANT_NAME" src/` で確認
- 関数は将来的に使用される可能性。削除前にチームに確認

### 推奨される削除対象（knip 結果から）
以下のエクスポートは削除しても安全と判断される：

**src/background/handlers/dashboardSqliteHandlers.ts**:
- `TOKEN_REQUIRED_SUBTYPES`
- `MODAL_REQUIRED_SUBTYPES`

**src/background/sessionAlarmsManager.ts**:
- `startTimeoutChecker`
- `stopTimeoutChecker`

**src/background/sqliteAlert.ts**:
- `_resetForTesting`

**src/constants/appConstants.ts**:
- `TRUST_LEVEL_COLORS`
- `TIMEOUTS_MINUTES`
- `SIZE_LIMITS`
- `RETRY_CONFIG`
- `DEFAULT_VISIT_SETTINGS`
- `DEFAULT_PORT`
- `ERROR_CODES`
- `NON_RECORDABLE_SCHEMES`
- `DOM_SELECTORS`

**src/dashboard/dashboard.ts**:
- `openSettingsPanel`
- `refreshLocalMarkdownScheduler`

**src/dashboard/main.ts**:
- `registry`

**src/offscreen/dbMaintenance.ts**:
- `getFtsIndexSize`
- `checkFtsIndexHealth`

**src/offscreen/schema.ts**:
- `INSERT_COLS`
- `INSERT_PLACEHOLDERS`
- `FTS5_SQL`

**src/offscreen/sqlite.ts**:
- `sqliteEngine`
- `getFtsIndexSize`
- `checkFtsIndexHealth`
- `NoopBackend`
- `OpfsWorkerBackend`
- `IdbVfsBackend`
- `FallbackStorageAdapter`

**src/popup/domUtils.ts**:
- `createStatusCircle`

**src/popup/main.ts**:
- `isRecordable`

**src/popup/navigation.ts**:
- `openHistory`

**src/popup/privacySettings.ts**:
- `renderPiiSample`

**src/popup/settings/aiProvider.ts**:
- `requestAIProviderPermission`

**src/popup/settings/fieldValidation.ts**:
- `showProtocolWarning`
- `clearProtocolWarning`

**src/popup/trustSettings.ts**:
- `default`

**src/utils/aiSummaryCleaner/index.ts**:
- `AD_CLASS_PATTERNS`
- `SOCIAL_CLASS_PATTERNS`
- `NAV_CLASS_PATTERNS`
- `LEGAL_TEXT_PATTERNS`
- `DEEP_CLASS_PATTERNS`
- `DEEP_ROLES`
- `GUTENBERG_STRUCTURAL_PATTERNS`
- `buildClassIdSelectors`
- `isFixedOrSticky`
- `isLikelyAd`
- `isLikelyPopup`
- `isPlatformNoise`
- `safeRemoveElement`
- `safeReplaceWithText`
- `markBodyElements`
- `unmarkBodyElements`
- `isBodyProtected`

**src/utils/contentExtractor/index.ts**:
- `EXCLUDED_ROLES`
- `EXCLUDED_TAGS`
- `EXCLUDED_CLASS_PATTERNS`
- `ASIA_CONTENT_CLASS_PATTERNS`
- `ASIA_CONTENT_ID_PATTERNS`

**src/utils/deviceUtils.ts**:
- `detectOsFromUserAgent`

**src/utils/i18n-dom.ts**:
- `getMessage`
- `getUserLocale`
- `isRTL`

**src/utils/rateLimiter.ts**:
- `RATE_LIMIT_ATTEMPTS`
- `RATE_LIMIT_WINDOW_MS`
- `LOCKOUT_DURATION_MS`
- `LOCKOUT_DURATION_MINUTES`

**src/utils/sentenceExtractor.ts**:
- `buildSentenceGraph`

**src/utils/storage.ts**:
- `encryptEnvelope`
- `decryptEnvelope`
- `migrateLegacyCiphertext`
- `isEncryptionEnvelope`
- `CURRENT_ENVELOPE_VERSION`

**src/utils/storageUrls.ts**:
- `MAX_CONTENT_ENTRIES`

**src/utils/trustDb/presetDomains.ts**:
- `TRANCO_TOP_1000_DOMAINS`

**src/utils/ublockParser/index.ts**:
- `parseDomainList`
- `parseRuleOptions`

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み（CHANGELOG.md）
