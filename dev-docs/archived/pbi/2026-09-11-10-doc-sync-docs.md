# PBI 10: ドキュメント drift の解消（ERROR_CODES 最重症）+ cleansingBadge の @layer ヘッダ

## ユーザーストーリー

このリポジトリで作業する AI エージェントやコントリビュータとして、dev-docs が現状のコードを正確にスナップショットしたものであり、誤ったパスや欠落したエラーコードに従わずに済むことを望む。docs 運用ルール（最新仕様のスナップショットのみ・履歴を書かない）に従い、現状に合わせる。

## 優先度

- 順位: 10 / 10
- RICE スコア: 5.0（Reach=2 / Impact=0.5 / Confidence=100% / Effort=0.2 人週）
- 根拠（2026-09-11 診断で drift 確認）:
  - `dev-docs/ERROR_CODES.md` — enum（`src/utils/logger/types.ts:7-76`）に存在する TRUST_DB_* / TRANCO_* / BLOOM_FILTER_ERROR / UNKNOWN_AI_PROVIDER / BADGE_UPDATE_FAILED / PERMISSION_REQUIRED など 8+ コードが未収録。:152 の「コード定義: `src/utils/logger.ts`」は誤り（正: `types.ts`）
  - `dev-docs/ARCHITECTURE_MAP.md` — round 4 モジュール（sqliteStatus.ts / contentFetchGateway.ts / cleansingBadge.ts / archiveWireTable.ts / queryPlan）が不在。`Storage` 行が retired shim `src/utils/storage.ts` を指す（正: `src/utils/storage/SettingsRepository.ts`）。Content Scripts ツリーが contentKernel/deadlineTimer/throttle 分割を未反映
  - `dev-docs/DESIGN_SPECIFICATIONS.md` §5.4:109 — STATUS を「fts5/fallback/path のみ」と記載（PBI 06 で extras 8+ フィールドが実装済み）。:107 の `opfsWorker.ts` 単数パスは現状ディレクトリと不一致
  - `dev-docs/ADR/2026-08-27-limit-policy.md` — SSOT 主張と `sqliteEngineHost.ts:56` の二重定義が乖離（PBI 08 で解消されるため status note を追記）
  - `src/utils/cleansingBadge.ts` — LAYERS.md チェックリスト要件の `// @layer 0` ヘッダ欠落

## BDD 受け入れシナリオ

```gherkin
Scenario: ERROR_CODES が enum を全て列挙する
  Given src/utils/logger/types.ts の ErrorCode enum
  When ERROR_CODES.md を確認する
  Then 全コードが収録され、定義パスは types.ts を指す

Scenario: ARCHITECTURE_MAP が round 4 モジュールを含む
  Given round 4 で新設されたモジュール群
  When マップを確認する
  Then sqliteStatus / contentFetchGateway / cleansingBadge / archiveWireTable が掲載され、
       storage 行は SettingsRepository を指す
```

## 受け入れ基準

- [x] ERROR_CODES.md: enum 全コード収録 + パス修正
- [x] ARCHITECTURE_MAP.md: round 4 モジュール追記 + storage 行修正 + content scripts ツリー更新
- [x] DESIGN_SPECIFICATIONS.md §5.4: STATUS extras 反映 + opfsWorker/ ディレクトリ表記
- [x] ADR 2026-08-27-limit-policy に status note（PBI 08 と同時コミット可）
- [x] cleansingBadge.ts に `// @layer 0` ヘッダ
- [x] docs 間の矛盾なし（PRIVACY 同期対象外）

## テスト戦略

type-check / build / check-i18n green（docs み + 1 行ヘッダ）。PBI 09 の grep ガードと干渉しないことを確認。

## 見積もり

S（0.2 人週）。種別: doc。

## 実装アプローチ

1. ERROR_CODES を types.ts 起点で書き直し → MAP / SPEC / ADR を順次更新
2. cleansingBadge ヘッダ追記（PBI 07 と同時でも可）

## 実装メモ（2026-09-11 round 5）

- ERROR_CODES.md: TRUST_DB_* ×3 / TRANCO_* ×2 / BLOOM_FILTER_ERROR / UNKNOWN_AI_PROVIDER / BADGE_UPDATE_FAILED / PERMISSION_REQUIRED を追加 + 定義パスを types.ts に修正。
- ARCHITECTURE_MAP.md: Shared Modules Quick Index 新設（round 4 モジュール）+ Content Scripts ツリー更新（contentKernel/deadlineTimer/throttle）+ Storage 行を SettingsRepository に修正。
- DESIGN_SPECIFICATIONS.md §5.4: STATUS extras（sqliteStatus.ts）反映 + opfsWorker/ ディレクトリ表記。
- ADR 2026-08-27-limit-policy に status note（QUERY_PLAIN_LIMIT 不採用・round 5 PBI 08 で SSOT 完成）。
- cleansingBadge.ts に `// @layer 0` ヘッダ追加。
- check-docs / check-i18n PASS。
