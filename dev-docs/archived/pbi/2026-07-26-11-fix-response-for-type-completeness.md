# PBI: ResponseForTypeの型マッピングを全メッセージ種別に対して完全化する

**作成日**: 2026-07-26
**完了日**: 2026-07-26
**優先度**: Low
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟢なし（型定義の追加のみ、実行時の挙動には影響しない）

## 実装メモ（2026-07-26）

`src/background/handlers/messageHandlers.ts`の各ハンドラーファクトリー（`createFetchUrlHandler`,
`createTestConnectionsHandler`等）が実際に`sendResponse()`へ渡す形状を1つずつ確認し、残り14種類
（GET_CONTENT, FETCH_URL, SAVE_RECORD, TEST_CONNECTIONS, TEST_OBSIDIAN, TEST_AI,
GET_PRIVACY_CACHE, ACTIVITY_UPDATE, SESSION_LOCK_REQUEST, CONTENT_CLEANSING_EXECUTED, PING,
REFRESH_LOCAL_MARKDOWN_SCHEDULER, CONSENT_STATE_CHANGED, GENERATE_REVIEW_SUMMARY,
DASHBOARD_SQLITE）全てに具体的な型を追加した。

**発見**: `GET_CONTENT`は実際にはService Worker宛ではなく**Content Script宛**のメッセージ
（`src/content/extractor.ts:859`で受信）であり、`popup/mainTypes.ts`の`ContentResponse`型を
既存の型として発見しそのまま使用した。`DASHBOARD_SQLITE`は`subtype`によって分岐する専用プロトコル
（`DashboardSqliteResponseFor<S>`）を持ち、`ResponseForType`の単純な条件型マッピングでは`subtype`を
見て分岐できないため、過度な抽象化を避けて`Record<string, unknown>`に留めた。

`PrivacyInfo`（`src/utils/privacyChecker.ts`）と`ContentResponse`（`src/popup/mainTypes.ts`）を
`messaging/types.ts`にimportした。`mainTypes.ts`が`messaging/types.ts`から`MaskedItem`を
importしているため型レベルの循環参照になるが、`import type`のみのため型チェックは問題なく通過
することを確認した。

型チェック・全テストスイート（7371件）・`messaging/types.test.ts`（65件）ともに回帰なし。

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の API & Contract Negotiator からの指摘。`src/messaging/types.ts:276-298`（現状）の `ResponseForType` は、18のメッセージ種別中4種のみ具体的なレスポンス型を持ち、残りは汎用フォールバック型になっている。型安全のメリットが一部のメッセージ種別でしか得られていない。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "ResponseForType" src/messaging/types.ts
grep -n "type ExtensionMessage\|export type.*Message" src/background/messageTypes.ts src/messaging/types.ts
```

全18種のメッセージ種別と、それぞれの実際のハンドラー（`src/background/service-worker.ts` 等でのレスポンス構築箇所）を照合し、レスポンス型を特定する。

## 受け入れ基準（BDD）

```gherkin
Scenario: 全メッセージ種別に具体的なレスポンス型が定義される
  Given ExtensionMessage の18種類のメッセージタイプ
  When ResponseForType<T> を確認する
  Then 全てのタイプについて汎用フォールバックではなく具体的な型が返る

Scenario: 型の不一致がコンパイル時に検出される
  Given 具体的な型が付与されたResponseForType
  When ハンドラー側で異なる形のレスポンドを返そうとする
  Then TypeScriptのコンパイルエラーで検出される

Scenario: 既存の呼び出し元コードが回帰しない
  Given 型定義を完全化した後のResponseForType
  When npm run type-check を実行する
  Then 既存の呼び出し元で新たな型エラーが発生しない（発生した場合は実際の型不一致バグである可能性が高いため個別に確認する）
```

## 受け入れ基準
- [ ] 18のメッセージ種別全てについて、実際のハンドラーが返すレスポンスの形を確認する
- [ ] `ResponseForType<T>` の型マッピングに残り14種の具体的な型を追加する
- [ ] `npm run type-check` で新たな型エラーが出ないことを確認する（出た場合は個別に精査し、実際のバグであれば修正する）
- [ ] 既存の `messaging` 関連テストが全てパスする

## テスト戦略

### 単体テスト
- 既存の `src/messaging/__tests__/types.test.ts` が回帰しないことを確認
- 型レベルの検証は `npm run type-check` で担保

## 実装アプローチ

1. `src/background/messageTypes.ts` および `service-worker.ts` の各メッセージハンドラーを確認し、実際のレスポンス形状を洗い出す
2. `ResponseForType<T>` に不足している14種のマッピングを追加
3. `npm run type-check` で全体を確認

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: `src/background/messageTypes.ts`
- テスタビリティ: 型チェックによる静的検証が主
- 非機能要件: 型安全性

## Definition of Done
- [ ] 全18種のメッセージ種別に具体的なレスポンス型が定義されている
- [ ] `npm run type-check` がパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（API & Contract Negotiator指摘）
- 対象コード: `src/messaging/types.ts:276-298`
