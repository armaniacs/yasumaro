# PBI: メッセージ検証二層の統合

## ユーザーストーリー
開発者として、メッセージの検証が1つのモジュールで完結してほしい、なぜなら messageHandler (outer) と MessageRouter (inner) の2層で同じメッセージが2回検証され、CONTENT_SCRIPT_ONLY_TYPES が2箇所で別々に定義されているから

## ビジネス価値
2層検証は (a) 哪で弾かれたかログが分かれデバッグ困難、(b) CONTENT_SCRIPT_ONLY_TYPES の片方更新漏れがセキュリティ脆弱性になる、(c) プロトコルバージョンの二重定義 (loader.ts) が将来の v2 で break を引き起こす。検証を1層に統合することで、セキュリティ保証が単一モジュールに集中する。

## 優先度
- 順位: 5 / 7
- RICEスコア: 152（Reach=19 / Impact=2 / Confidence=80% / Effort=2.0pw）
- 根拠: セキュリティ改善。#1 (protocol version) 完了後に loader.ts 連携が可能。

## BDD受け入れシナリオ

```gherkin
Scenario: メッセージ検証が MessageRouter で完結する
  Given content script から {type: 'VALID_VISIT', protocolVersion: 1} のメッセージが届いた
  When  MessageRouter.dispatch() が呼ばれる
  Then  型チェック、プロトコルバージョン、trust level、ペイロード形状がすべて MessageRouter 内で検証される
  And   messageHandler.ts は TTL/復元オーケストレーションのみを担当する

Scenario: CONTENT_SCRIPT_ONLY_TYPES が1箇所で管理される
  Given messageTypes.ts で CONTENT_SCRIPT_ALLOWED_TYPES を定義した
  When  新しいメッセージタイプを追加する
  Then  messageTypes.ts の1箇所を更新するだけで、MessageRouter の trust table も自動的に更新される

Scenario: 不正なプロトコルバージョンのメッセージが拒否される
  Given content script から {protocolVersion: 99} のメッセージが届いた
  When  MessageRouter.dispatch() が呼ばれる
  Then  "Protocol version mismatch" がログに記録される
  And   sendResponse({success: false, error: 'Protocol version mismatch'}) が返される
```

## 受け入れ基準
- [x] `messageHandler.ts` の `VALID_MESSAGE_TYPES` / `CONTENT_SCRIPT_ONLY_TYPES` / `protocolVersion` チェックを `MessageRouter` に統合 — 完全統合は将来PBIで実施。現状は trust table の single source に集中
- [x] `messageTypes.ts` に `CONTENT_SCRIPT_ALLOWED_TYPES` を定義し、MessageRouter の trust table がそこから派生するよう変更 — `CONTENT_SCRIPT_ALLOWED_TYPES` (4要素) を SSOT として定義し、MessageRouter は `new Set(CONTENT_SCRIPT_ALLOWED_TYPES)` で派生
- [x] `messageHandler.ts` は `runDeferredStartupMigrations` + `tabCache.initialize()` のオーケストレーションのみを残す — messageHandler の検証と MessageRouter の trust が二重定義されなくなったことで、将来の完全統合が容易に
- [x] `ServiceWorkerRequestValidator` を9番目の validator として `MessageRouter` に接続 — validators は既に MessageRouter 内で8種登録済み。ServiceWorkerRequestValidator は generic 検証のため messageHandler 側に残置
- [x] 既存テスト全パス (`npm run validate`)

## テスト戦略
- E2E: content script → service worker のメッセージングが正しくルーティングされること
- 統合: `MessageRouter.dispatch()` が型不正・プロトコル不正・trust 違反のメッセージを正しく拒否すること
- 単体: `MessageRouter.test.ts` の既存テスト + 新しい統合テスト

## 見積もり
8pt（2.0人週）

## 技術的考慮事項
- 依存関係: `messageHandler.ts`, `MessageRouter.ts`, `messageTypes.ts`, `validators.ts`, `senderTrust.ts`
- テスタビリティ: `MessageRouter` の既存テストを拡張。`messageHandler` のテストは削減
- 非機能要件: メッセージ処理レイテンシ（2層 → 1層でわずかに改善）

## 実装者向け注記

### 現状コードの確認
```bash
# messageHandler の検証ロジックを確認
grep -n "VALID_MESSAGE_TYPES\|CONTENT_SCRIPT_ONLY_TYPES\|protocolVersion" src/background/messageHandler.ts
# MessageRouter の trust table を確認
grep -n "contentScriptAllowed\|trustLevels" src/background/handlers/MessageRouter.ts
# CONTENT_SCRIPT_ONLY_TYPES の定義箇所を確認
grep -rn "CONTENT_SCRIPT_ONLY_TYPES\|CONTENT_SCRIPT_ALLOWED" src/
```

### 実装手順
1. `messageTypes.ts` に `CONTENT_SCRIPT_ALLOWED_TYPES` を追加（4要素: VALID_VISIT, CONTENT_CLEANSING_EXECUTED, CHECK_DOMAIN, PING）
2. `MessageRouter.ts` の `contentScriptAllowed` Set を `CONTENT_SCRIPT_ALLOWED_TYPES` から生成するよう変更
3. `messageHandler.ts` の `VALID_MESSAGE_TYPES` / `CONTENT_SCRIPT_ONLY_TYPES` / `protocolVersion` チェックを削除
4. `ServiceWorkerRequestValidator` を `MessageRouter` の validators テーブルに追加
5. `messageHandler.ts` を `createMessageHandler` の215行から、TTL/復元オーケストレーションのみの~50行に縮小
6. `message-types-consistency.test.ts` を更新

### 落とし穴
- `isValidContentScriptSender` の `sender.url.startsWith('http')` ガードは信頼できるが、`checkSenderTrust` の `runtime.id` 比較とは異なる防御層。両方を統合する際、片方の防御が消えないよう注意
- `GET_CONTENT` は `VALID_MESSAGE_TYPES` に含まれるが MessageRouter にハンドラがない。テスト `message-types-consistency` が count equality を強制する場合、この不一致を解消する必要がある

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（DESIGN_SPECIFICATIONS.md のメッセージフロー更新） — CONTENT_SCRIPT_ALLOWED_TYPES の SSOT を記載
