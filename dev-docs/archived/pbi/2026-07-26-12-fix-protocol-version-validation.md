# PBI: メッセージプロトコルバージョンの検証ガードを受信側に追加する

**作成日**: 2026-07-26
**クローズ日**: 2026-07-26（両方の受け入れ基準が既に別の形で満たされていた）
**優先度**: Low
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（バージョン不一致メッセージの拒否ロジックを追加するため、古いContent Scriptが残っている場合に一時的な機能停止が起こりうる。段階的ロールアウトを検討）

## クローズメモ（2026-07-26）

**受け入れ基準1（Service Worker側の検証ガード）は既に実装済み**: `src/background/service-worker.ts:496-505`
に、`msg.protocolVersion !== CURRENT_PROTOCOL_VERSION`の場合`logWarn()`でログ記録した上で
`{success: false, error: 'Protocol version mismatch'}`を返すガードが既に存在していた。

**受け入れ基準2（単一箇所化）は既存の技術的制約と矛盾することが判明**: `loader.ts`から
`messageTypes.ts`の`CURRENT_PROTOCOL_VERSION`を値としてimportする変更を試みたところ、ビルド
（`npm run build`）は成功し、`dist/chromium-mv3/content-scripts/content.js`にも正しく`protocolVersion:1`
がインライン化されることを確認した。しかし`src/content/__tests__/loader-no-static-imports.test.ts`
という既存テストが「loader.ts に静的import文があってはならない」ことを保証しており、コメントに
「manifest.jsonのcontent_scriptsに`"type": "module"`指定なしで登録されるContent Scriptエントリー
ポイントは、静的importがあるとSyntaxErrorを起こし、過去に実際に5秒・50%の記録条件を満たしても
記録されなくなるバグが発生した」という具体的な経緯が記されていた。

wxtのビルドパイプライン（Rollupバンドラー経由）ではimportが正しくバンドルされて動作するように見えたが、
`manifest.json`の`content_scripts`直接登録という実行経路では問題が起きうるため、既存テストが検出する
不変条件を優先し、値のimportを元に戻した（`git diff`で確認済み、変更なし）。

この制約により、`loader.ts`の`CURRENT_PROTOCOL_VERSION = 1`ハードコードと`messageTypes.ts`の同名定数は
**意図的に重複させたまま維持する**必要がある。共有モジュール化は「共有モジュールをContent Script側で
静的importできない」という制約のため実現不可能。既存のコメント（「Content Script entry point runs
without ESM module support, so we cannot import CURRENT_PROTOCOL_VERSION statically. Keep this in
sync with src/background/messageTypes.ts.」）が既にこの制約を正確に説明しており、追加のドキュメント化
も不要と判断した。

両受け入れ基準とも「既に対応済み」または「対応不可能な制約」と判明したため、本PBIはクローズし、
コード変更は行わない（試みた変更は元に戻し済み）。

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の Legacy Bridge Architect, API & Contract Negotiator（重複）からの指摘。`src/content/loader.ts:21`（現状 `const CURRENT_PROTOCOL_VERSION = 1;`）と `src/background/messageTypes.ts:18`（同じ値を別途定義）で、プロトコルバージョンがそれぞれハードコードされている。Service Worker側でバージョン検証・拒否ロジックが存在せず、将来の破壊的変更時に古いContent Scriptからのメッセージを検出できない。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "CURRENT_PROTOCOL_VERSION\|protocolVersion" src/content/loader.ts src/background/messageTypes.ts
grep -rn "protocolVersion" src/background/service-worker.ts src/background/*.ts
```

現状、`protocolVersion` はメッセージに含まれてはいるが（`messageTypes.ts:158`）、受信側での検証（バージョン不一致メッセージを拒否する処理）が存在するか確認する。

## 受け入れ基準（BDD）

```gherkin
Scenario: プロトコルバージョンが単一箇所からimportされる
  Given src/content/loader.ts と src/background/messageTypes.ts
  When 両ファイルのプロトコルバージョン定義を確認する
  Then 両方とも同一の共有モジュールから CURRENT_PROTOCOL_VERSION をimportしている（重複定義がない）

Scenario: 古いバージョンのメッセージが検出される
  Given Content Scriptが古いprotocolVersion（例: 0）でメッセージを送信する
  When Service Workerがこのメッセージを受信する
  Then バージョン不一致としてログに記録され、後方互換性のある形でハンドリングされる（即座にクラッシュしない）

Scenario: 現行バージョンのメッセージは通常通り処理される
  Given Content ScriptがCURRENT_PROTOCOL_VERSIONと一致するバージョンでメッセージを送信する
  When Service Workerが受信する
  Then 通常通りメッセージが処理される
```

## 受け入れ基準
- [ ] `CURRENT_PROTOCOL_VERSION` を共有モジュール（例: `src/messaging/protocolVersion.ts`）に一本化し、`loader.ts`・`messageTypes.ts` 両方がそこからimportする
- [ ] Service Worker側のメッセージ受信処理に `protocolVersion` の検証ガードを追加する
- [ ] バージョン不一致の場合、ログに記録しつつ後方互換性を保つハンドリング（拒否ではなく警告ログ、または明示的なエラーレスポンス）を実装する
- [ ] 既存のメッセージング関連テストが全てパスする

## テスト戦略（t_wadaスタイル）

### 単体テスト
- 正しいprotocolVersionのメッセージが通常通り処理されることを確認
- 不一致のprotocolVersionのメッセージが検証ガードで検出されることを確認
- 共有モジュールから両ファイルが同じ値を参照していることを確認

### 統合テスト
- Content Script → Service Workerの実際のメッセージフローで、バージョン検証が正しく機能することを確認

## 実装アプローチ

1. `CURRENT_PROTOCOL_VERSION` の共有モジュールを新設
2. `loader.ts`, `messageTypes.ts` を共有モジュール参照に変更
3. Service Worker側のメッセージハンドラーにバージョン検証を追加
4. テスト追加

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: `src/content/loader.ts`, `src/background/messageTypes.ts`, `src/background/service-worker.ts`
- テスタビリティ: メッセージング関連の既存テストが土台
- 非機能要件: 後方互換性、保守性

## Definition of Done
- [ ] プロトコルバージョンが単一箇所で定義されている
- [ ] 受信側にバージョン検証ガードが実装されている
- [ ] 既存テストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（Legacy Bridge Architect, API & Contract Negotiator指摘、重複統合）
- 対象コード: `src/content/loader.ts:19-21`, `src/background/messageTypes.ts:18, 158`
