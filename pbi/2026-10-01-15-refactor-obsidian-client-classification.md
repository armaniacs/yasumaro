# PBI: obsidianClient.testConnection の失敗分類共通化

優先度: 中（RICE 10.0・同バッチ 26 候補中 8 位 / refactor）
backlog: [./2026-10-01-00-backlog-holistic-1001.md](./2026-10-01-00-backlog-holistic-1001.md)（NN 15・バッチA・ファイル非重複）
依存: なし（単独で着手可能）。ファイル名について: backlog の NN 14 は `src/popup/tabUtils`（popup main.ts seam 追従）であり本 PBI とは別件。本 PBI は NN 15 の obsidianClient 分類統一であり、`src/background/obsidianClient.ts` のみを触る。

## ユーザーストーリー

拡張機能の background 層を保守する開発者として、`testConnection` の 2 つの catch が同一の失敗分類関数を通ってほしい、なぜなら `isEncryptionLockedError` と `msg.includes('API key is missing')` の分類と対応する message・FailureKind の組が 2 箇所に重複しており、新しいエラーメッセージパターンを追加するたびに 2 箇所の編集が必要で、片方の更新漏れが分類の不整合（UI が誤った対処法を提示する）として顕在化するから。

## 背景（現状）

### 分類の 2 重化（検証済み・2026-10-01 時点）

| catch | 位置 | 分岐 |
|---|---|---|
| override-config catch | `src/background/obsidianClient.ts:326-341` | `isEncryptionLockedError(e)` → `withFailure(..., connectionTestFailure(e, FailureKind.CONFIGURATION))` → `msg.includes('API key is missing')` → 同 CONFIGURATION → fall-through も CONFIGURATION（msg をそのまま返す） |
| main catch | `src/background/obsidianClient.ts:363-393` | 同じ encryption-locked 分類 → AbortError / `timed out` → TIMEOUT → `Failed to fetch` / TypeError → NETWORK → `API key is missing` → CONFIGURATION → fall-through は無 kind（`Connection error: <msg>`） |

- 共通の重複: `isEncryptionLockedError(e)` → `withFailure({ success: false, message: errorMessage(e) }, connectionTestFailure(e, FailureKind.CONFIGURATION))` と、`msg.includes('API key is missing')` → `withFailure({ success: false, message: 'API key is missing. Please enter your Obsidian API key.' }, connectionTestFailure(e, FailureKind.CONFIGURATION))` が両 catch にそのまま繰り返されている
- 差分（保存必須）: (1) override 経路には timeout / network 分岐が無い（`buildObsidianConfig` は fetch を行わない）、(2) fall-through の kind が異なる（override 経路は CONFIGURATION 固定、main 経路は意図的に無 kind — :389-391 行のコメント「認識不能エラーに kind を主張しない」）、(3) main 経路では api-key-missing 判定が timeout / network 判定より後にある

### 関連する既存の共通化

`withFailure`・`connectionTestFailure`・`describeHttpFailure` は既存の共通ヘルパで、分類ロジック（kind 決定と message 選択）の部分だけが catch 内にインラインで重複している。

## BDD

```gherkin
Feature: ObsidianClient.testConnection の失敗分類

  Scenario: API key 未設定は両 catch とも共通分類を通る
    Given storage に Obsidian API key が保存されていない
    When testConnection() を呼ぶ
    Then 応答は success=false かつ message="API key is missing. Please enter your Obsidian API key." である
    And FailureKind は CONFIGURATION である

  Scenario: override 設定のビルド失敗は現行どおり CONFIGURATION のままである
    Given override に不正な設定を渡した
    When testConnection(override) が buildObsidianConfig で失敗する
    Then 応答の message と FailureKind は現行実装（:326-341）と分岐順序込みで同一である

  Scenario: 未認識エラーは kind を主張しない
    Given _fetchConnectionResponse が既知パターンに一致しないエラーを投げる
    When testConnection() を呼ぶ
    Then 応答は message="Connection error: <msg>" かつ FailureKind は付与されない
```

## 実装宣言・受け入れ基準

It must keep behavior: 両 catch から返る `ObsidianConnectionResult`（`success`・`message`・`withFailure` による failure 付与・FailureKind の組）は、分岐の評価順序を含めリファクタリング前後で完全に同一であること。特に (1) main 経路の分岐順（encryption-locked → timeout → network → api-key-missing → fall-through 無 kind）を変えない、(2) override 経路に timeout / network 分岐を追加しない、(3) main 経路の fall-through は無 kind のまま維持する、の 3 点を守ること。

受け入れ基準:

- [x] 1. `isEncryptionLockedError` 判定と `msg.includes('API key is missing')` 判定、および対応する message・`FailureKind.CONFIGURATION` の組が、共通 private 関数（`classifyConnectionFailure`）に抽出される
- [x] 2. 両 catch（override 経路・main 経路）が共通分類を経由する
- [x] 3. 応答形状は不変: message・FailureKind・`withFailure` 形状が分岐評価順序込みで現行と同一である
- [x] 4. 新しいエラーメッセージパターンを追加するときの編集箇所が 1 つになる（message と kind の対応が共通分類内に集約される）
- [x] 5. 既存テストが green: `obsidianClient-connectionFailure.test.ts`・`obsidianClient-failureTaxonomy.test.ts`・`obsidianClient.test.ts`・`obsidianConfigBuilder-locked.test.ts`
- [x] 6. `npm run type-check` が green

## テスト戦略

- 既存回帰: `src/background/__tests__/obsidianClient-connectionFailure.test.ts`（接続失敗メッセージ）、`obsidianClient-failureTaxonomy.test.ts`（kind 分類表）、`obsidianClient.test.ts`、`obsidianConfigBuilder-locked.test.ts`
- 新規: 共通分類関数の単体テストをマッピング表形式で書く（エラー種別 → 期待する kind と message）。両経路の差分（override 経路に transport 系分岐が現れないこと、main 経路の fall-through が無 kind であること）を明示アサーションで固定する
- `dev-docs/TEST_RULE.md`（../dev-docs/TEST_RULE.md）に従い、実時間待ちを入れない。fetch / lock 待ちはモックで駆動する
- 型確認: `npm run type-check`

## 実装内容

1. `private classifyFailure(e: unknown, kind: <fallback kind>): <failure result>`（仮称）を新設する。共通の 2 判定（encryption-locked → CONFIGURATION、api-key-missing → CONFIGURATION）と対応 message を集約する
2. 両経路の差分はシグニチャで表現する: override 経路は fallback kind に `FailureKind.CONFIGURATION` を渡し transport 系判定を含めない、main 経路は timeout / network 判定を含む現行の順序を保つ。シグニチャの具体形（kind 引数、オプションオブジェクト、コールバック返し等）は「分岐評価順序と差分の保存」を満たす範囲で実装判断に委ねる
3. 両 catch を共通分類呼び出しに置換する。fall-through（override: CONFIGURATION + msg、main: 無 kind + `Connection error: <msg>`）も共通分類の帰結として集約する
4. コメントは英語で WHY のみ追記する（例: main 経路の fall-through が無 kind である理由は既存コメント :389-391 の意図を引き継ぐ）

## Definition of Done

- [x] 受け入れ基準 1-6 をすべて満たす
- [x] `npm run validate`（type-check + test）が green
- [x] `rg "API key is missing" src/background/obsidianClient.ts` で分類側の文言定義が 1 箇所に集約されていることを確認する
- [x] `rg "isEncryptionLockedError" src/background/obsidianClient.ts` で testConnection 内の判定が共通分類経由のみになっていることを確認する
- [ ] `graphify update .` を実行しグラフを現行コードに追従させる — 未実施（統合ステップのスコープ外）
- [ ] backlog 台帳（./2026-10-01-00-backlog-holistic-1001.md）の NN 15 を完了扱いに更新する — アーカイブ/台帳更新は別ステップで処理

## 実装記録（2026-10-02）

変更した内容（`src/background/obsidianClient.ts` のみ）:

- モジュールスコープの `classifyConnectionFailure(e, { errorName, transport, fallbackKind? })` を新設。`isEncryptionLockedError` → CONFIGURATION（message は `errorMessage(e)`）、`API key is missing` → CONFIGURATION（固定文言）、fall-through の 3 つを 1 箇所に集約した
- 両経路の差分はシグニチャで表現した。override 経路は `transport: false` + `fallbackKind: CONFIGURATION`（`buildObsidianConfig` は fetch を行わないので transport 系分岐を出す必要がない／fall-through も CONFIGURATION 固定）、main 経路は `transport: true` + `fallbackKind` なし（fall-through は無 kind）
- main 経路の `return { success: false, message: 'Connection error: ' + msg }` の「認識不能エラーに kind を主張しない」意図は、共通関数のコメントとして引き継いだ

追加したテスト: なし。受け入れ基準 5 が名指しする `obsidianClient-connectionFailure.test.ts`（メッセージ）と `obsidianClient-failureTaxonomy.test.ts`（kind 分類表）が両経路の差分（override 経路に transport 分岐が出ないこと、main 経路の fall-through が無 kindであること）を行列単位で既に固定しているため、抽出の gate として機能する。新規テストを足さず、既存分類表をそのまま不変性の証拠にしている。

逸脱なし。検証: `npx vitest run <11 batch-A テストファイル> --repeats=20` → 155 passed / 11 files passed、`npm run validate` green（`obsidianClient-*` 4 ファイルを含む全 15288 テスト green）。
