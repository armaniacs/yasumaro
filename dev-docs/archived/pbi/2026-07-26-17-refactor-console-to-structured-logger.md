# PBI: offscreen/dashboard内の生console出力を構造化ロガーに置き換える

**作成日**: 2026-07-26
**完了日**: 2026-07-26（dashboard側のみ。Offscreen側はPBI-34に分割）
**優先度**: Medium
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（Offscreen Documentは直接chrome.storageやloggerモジュールにアクセスできない制約があるため、メッセージバス経由の中継実装が必要）

## 実装メモ（2026-07-26）

`src/dashboard/cspSettings.ts`（dashboard側、直接`addLog()`呼び出し可能）の8件の`console.*`呼び出しを
`addLog(LogType.ERROR/WARN, message, {details})`形式に置き換えた。`errorMessage()`でエラーオブジェクトを
文字列化してから渡す既存パターンに倣った。

Offscreen側（`offscreen.ts`9件、`opfsWorker.ts`6件、`sqliteEngineContext.ts`6件、計21件）は
Service Worker経由のログ中継機構という新規設計・実装が必要で規模が大きいため、
`2026-07-26-34-refactor-offscreen-console-to-logger.md`として別PBIに分割した。

回帰確認で`cspSettings.test.ts`の3件のテスト（`console.error`スパイを検証していた）が失敗した。
`logger.js`の`vi.mock`を追加し、`addLog`呼び出しの検証に更新した。既存47件と合わせて全てパス。
型チェック・全テストスイート（7372件）ともに回帰なし。

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の SRE/Ops Specialist, Blue Team Leader, DX Advocate（重複）からの指摘。`src/offscreen/offscreen.ts`, `src/offscreen/sqliteEngineContext.ts`, `src/dashboard/cspSettings.ts`, `src/offscreen/opfsWorker.ts` に構造化ロガーを経由しない `console.*` 出力が20箇所以上存在する。PII サニタイズ未通過、ログ保持ポリシー対象外、本番障害調査時に取得不可という問題がある。

**2026-07-26時点の調査で件数を確認した**: `offscreen.ts`(9件), `opfsWorker.ts`(6件), `cspSettings.ts`(8件), `sqliteEngineContext.ts`(6件) の合計29件が現存する。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -c "console\." src/offscreen/offscreen.ts src/offscreen/sqliteEngineContext.ts src/dashboard/cspSettings.ts src/offscreen/opfsWorker.ts
```

Offscreen DocumentとWorker（`opfsWorker.ts`）は、Service Workerとは別コンテキストで動作するため、既存の `logger.ts`（`addLog`）を直接呼び出せない可能性がある。メッセージパッシング経由でService Workerにログを中継する仕組みが必要かどうかを既存の実装パターン（`sqliteEngineContext.ts` のメッセージ送受信）を参考に確認する。`cspSettings.ts` はdashboard側（通常のスクリプトコンテキスト）なので直接loggerを呼び出せるはずである。

## 受け入れ基準（BDD）

```gherkin
Scenario: dashboardのconsole出力が構造化ロガーに置き換わる
  Given src/dashboard/cspSettings.ts のconsole.*呼び出し
  When 構造化ロガー（addLog）に置き換える
  Then 出力内容がPIIサニタイズを経由し、ログ保持ポリシーの対象になる

Scenario: OffscreenのconsoleがService Worker経由でログ中継される
  Given src/offscreen/offscreen.ts, opfsWorker.ts, sqliteEngineContext.tsのconsole.*呼び出し
  When メッセージバス経由でService Workerにログを送信する仕組みに置き換える
  Then Service Worker側でaddLog()を通じて構造化ログとして保存される

Scenario: 既存の動作が回帰しない
  Given ログ出力方式を変更した後のコード
  When 既存のoffscreen/dashboard関連テストを実行する
  Then 全てパスする
```

## 受け入れ基準
- [ ] `src/dashboard/cspSettings.ts` の8件のconsole出力を直接 `addLog()` 呼び出しに置き換える
- [ ] `src/offscreen/offscreen.ts`, `opfsWorker.ts`, `sqliteEngineContext.ts` について、Service Worker宛のログ中継メッセージ機構を設計・実装する（既存のメッセージ型に `LOG_FORWARD` 等を追加）
- [ ] Offscreen側の29件のconsole出力をログ中継機構経由に置き換える
- [ ] 既存の関連テストが全てパスする

## テスト戦略（t_wadaスタイル）

### 単体テスト
- ログ中継メッセージが正しい形式で送信されることを確認
- Service Worker側で中継メッセージを受信し `addLog()` が呼ばれることを確認
- `cspSettings.ts` の直接呼び出しが正しくaddLogを呼ぶことを確認

### 統合テスト
- Offscreen Document起動からログ中継、Service Worker側でのログ保存までの一連の流れを確認

## 実装アプローチ

1. `cspSettings.ts`（dashboard側、直接呼び出し可能）から着手し、`addLog()` への置き換えパターンを確立する
2. Offscreen側のログ中継メッセージ型を設計（`src/background/messageTypes.ts` に追加）
3. Offscreen側でのログ送信ヘルパー関数を作成し、各ファイルのconsole呼び出しを置き換える
4. Service Worker側でメッセージを受信し `addLog()` を呼ぶハンドラーを追加

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: `src/utils/logger.ts`, `src/background/messageTypes.ts`
- テスタビリティ: メッセージパッシングのモックが必要
- 非機能要件: 可観測性（SRE/Ops）、セキュリティ（PIIサニタイズ）

## Definition of Done
- [ ] dashboard側のconsole出力が構造化ロガーに置き換わっている
- [ ] Offscreen側のconsole出力がログ中継機構経由になっている
- [ ] 既存テストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（SRE/Ops Specialist, Blue Team Leader, DX Advocate指摘、重複統合）
- 対象コード: `src/offscreen/offscreen.ts`, `src/offscreen/sqliteEngineContext.ts`, `src/dashboard/cspSettings.ts`, `src/offscreen/opfsWorker.ts`
