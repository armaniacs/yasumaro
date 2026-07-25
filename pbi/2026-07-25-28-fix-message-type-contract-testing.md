# PBI: 新規メッセージタイプ追加時に型整合性テストが自動的に検証される仕組みを導入する

**作成日**: 2026-07-25
**優先度**: Low
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟢なし（テストインフラの追加のみ、既存の実行時挙動には影響しない）

---

## 背景

Checking Team レビュー（2026-07-25）の API & Contract Negotiator からの指摘。`src/background/messageTypes.ts`, `src/messaging/types.ts` のメッセージタイプはstringベースの判別で、送信側と受信側の型が完全に一致しているかは静的検証に依存している。`Messenger Types Uniformity` テストが既に存在するが（`src/messaging/__tests__/types.test.ts`）、新規メッセージタイプ追加時に手動での追加漏れが起こりうる。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
find src/messaging -iname "*.test.ts"
grep -n "Uniformity\|describe\|it(" src/messaging/__tests__/types.test.ts
grep -n "export.*Type\|export.*enum" src/background/messageTypes.ts src/messaging/types.ts
```

既存の `types.test.ts` がどのように「手動で追加が必要」なテストになっているか（新しいメッセージタイプごとに個別のexpectを書く必要があるのか）を確認し、網羅的にファイルをスキャンして自動検証する仕組みに変更できるか検討する。

## 受け入れ基準（BDD）

```gherkin
Scenario: 新規メッセージタイプが自動的にテスト対象になる
  Given messageTypes.ts に新しいメッセージタイプが追加される
  When テストスイートを実行する
  Then 手動でテストケースを追加しなくても、送信側・受信側の型定義の整合性が自動的に検証される

Scenario: 型定義が不整合な場合にテストが失敗する
  Given messageTypes.ts と実際のハンドラーで期待するペイロード型が一致しない状態を意図的に作る
  When テストスイートを実行する
  Then 不整合が検出されテストが失敗する

Scenario: 既存の全メッセージタイプでテストがパスする
  Given 現在定義されている全メッセージタイプ
  When 自動検証テストを実行する
  Then 全て整合性が取れていることが確認される
```

## 受け入れ基準
- [ ] `messageTypes.ts` / `src/messaging/types.ts` からメッセージタイプの一覧をプログラム的に抽出する仕組みを作る（TypeScriptの型情報から、または実行時のオブジェクトキー列挙から）
- [ ] 各メッセージタイプについて、送信側（呼び出し箇所）と受信側（ハンドラー）のペイロード型が一致することを検証するテストを作成する
- [ ] 新規メッセージタイプ追加時、このテストを更新しなくても自動的にカバレッジに含まれることを確認する
- [ ] 既存の `Messenger Types Uniformity` テストと統合または置き換える

## テスト戦略（t_wadaスタイル）

### 単体テスト
- 新しいメッセージタイプを一時的に追加し、テストが自動的にそれを検出することを確認（メタテスト）
- 既存の全メッセージタイプが検証をパスすることを確認

## 実装アプローチ

1. 既存の `src/messaging/__tests__/types.test.ts` の実装方式を確認
2. TypeScriptの型情報を実行時に検証する方法（例: 型ガード関数の自動生成、またはスキーマベースの検証ライブラリ導入）を検討
3. 網羅的な自動検証テストとして実装
4. 既存テストと統合

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: `src/background/messageTypes.ts`, `src/messaging/types.ts`
- テスタビリティ: 既存の `types.test.ts` が土台
- 非機能要件: 型安全性、保守性

## Definition of Done
- [ ] 新規メッセージタイプが自動的に検証対象になる仕組みが実装されている
- [ ] 既存の全メッセージタイプでテストがパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（API & Contract Negotiator指摘）
- 対象コード: `src/background/messageTypes.ts`, `src/messaging/types.ts`, `src/messaging/__tests__/types.test.ts`
