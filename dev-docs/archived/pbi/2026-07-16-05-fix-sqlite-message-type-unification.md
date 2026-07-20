# PBI: SW↔offscreen 間 SQLite メッセージ型の単一ソース化

## ユーザーストーリー

開発者として、Service Worker（`sqliteClient.ts`）と offscreen document（`offscreen.ts`）の間でやり取りする `SQLITE_*` メッセージ型を単一ソース化したい、なぜなら現状は両ファイルに文字列リテラルとして重複定義されており、typo によるプロトコル不整合が実行時エラーになるまで検知できないから。

出典: `docs/blog-6_5/offscreen-opfs-sqlite-coexistence-deep-dive.md`「開発者の方向け: すぐに効く改善案」より。
関連ADR: `dev-docs/ADR/2026-06-17-opfs-fts5-coexistence.md`（ADR-014）。

本PBIは元 `pbi/2026-07-16-03-fix-offscreen-opfs-sqlite-coexistence.md`（brainstormingで深掘り後に3+1分割）の一部。旧PBI-3（メッセージ型単一化）とPBI-4（メッセージング契約可視化）を統合したもの。関連: [[2026-07-16-04-fix-adr014-file-references]] [[2026-07-16-06-fix-idb-fallback-subframe7536-migration]]

## スコープ

**対象**: SW↔offscreen 間（`src/background/sqliteClient.ts` ↔ `src/offscreen/offscreen.ts`）の1境界のみ。

**明示的スコープ外**: offscreen↔Worker 間（`src/offscreen/offscreen.ts` ↔ `src/offscreen/opfsWorker.ts`、`Worker.postMessage` 経由）。理由は下記「既実装確認」参照。

## ビジネス価値

- `SQLITE_*` メッセージ型を1箇所に定義し、SW↔offscreen 間のプロトコル不整合（typo による実行時エラー）を型チェックの段階で防ぐ
- 存在しないメッセージ型を送信するコードがコンパイルエラーになることで、機能追加時の安全性を高める
- Offscreen/OPFS 層の SW↔offscreen メッセージング契約をドキュメント化し、知識グラフ上の孤立ノード（`sqliteClient.ts`）による影響範囲見落としを防ぐ

## 既実装確認（brainstormingで実施済み — 元PBIの想定より実態が複雑だった）

```bash
# sqliteClient.ts は SQLITE_ プレフィックス付き文字列リテラルで送信
grep -n "SQLITE_INIT\|SQLITE_INSERT\|SQLITE_SEARCH\|SQLITE_STATUS" src/background/sqliteClient.ts
# → 'SQLITE_INIT', 'SQLITE_INSERT' 等、20種以上の文字列リテラルが直書きされている

# offscreen.ts は if-else チェーンで受信（約20分岐）
grep -n "msg.type ===" src/offscreen/offscreen.ts
# → if (msg.type === 'SQLITE_INIT') {...} else if (msg.type === 'SQLITE_INSERT') {...} ...
#    という巨大if-elseチェーン（180-407行目付近）

# opfsWorker.ts は SQLITE_ プレフィックスなしの別名前空間で switch
grep -n "case '" src/offscreen/opfsWorker.ts
# → case 'INIT': case 'INSERT': ... （708行目〜、SQLITE_ プレフィックスなし）
```

**判明した実態**: メッセージ型は当初の想定（sqliteClient.ts と opfsWorker.ts の2箇所の重複）より複雑で、実質3層に散在している。
1. `sqliteClient.ts`（SW側）: `SQLITE_XXX` 文字列で `chrome.runtime.sendMessage`
2. `offscreen.ts`: `SQLITE_XXX` を if-else チェーンで受信し、`sqliteEngineContext` 等のメソッドを呼ぶか、Worker へ委譲
3. `opfsWorker.ts`（Web Worker）: `XXX`（`SQLITE_` プレフィックスなし）で `Worker.postMessage` を受信

**なぜなぜ分析の結論**: 型が散在した根本原因は、機能追加のたびに「1機能=1メッセージ型をその場で追記」するのが毎回最も低リスクに見え続けたことで、SW↔offscreen と offscreen↔Worker という2つの通信境界が一度も一元管理されなかったこと。offscreen↔Worker は offscreen.ts 内に閉じた実装詳細であり SW 側は関知しないため、**型統一の価値が高いのは SW↔offscreen の1境界のみ**と判断する。offscreen↔Worker の統一は本PBIのスコープ外とし、必要であれば別PBIとして扱う。

```bash
# src/messaging/ ディレクトリは既存（RecordingResult, MaskedItem 等の discriminated union 定義済み）
ls src/messaging/
# → types.ts, __tests__/
```

新しい SQLite メッセージ型もこの `src/messaging/` 配下に置き、既存の型定義パターン（discriminated union + 型ガード関数）を踏襲する。

## BDD受け入れシナリオ

```gherkin
Feature: SQLITE_* メッセージ型の単一ソース化（SW↔offscreen間）

  Scenario: SW と offscreen が同一のメッセージ型を参照する
    Given src/background/sqliteClient.ts が 'SQLITE_INSERT' を送信する
    When  src/offscreen/offscreen.ts の handleOffscreenMessage が受信する
    Then  両者は src/messaging/sqliteMessages.ts の同一 discriminated union から参照している
    And   存在しないメッセージ型を送った場合はコンパイルエラーになる

  Scenario: 未知メッセージ型は明示的に破棄される
    Given offscreen が SQLITE_* 以外の type を受信した
    When  offscreen.ts のメッセージディスパッチを確認する
    Then  default ケースで unknown type としてログに記録され、クラッシュしない

  Scenario: offscreen↔Worker 間は本PBIのスコープ外である
    Given src/offscreen/opfsWorker.ts が SQLITE_ プレフィックスなしの型名で switch している
    When  本PBIの変更範囲を確認する
    Then  opfsWorker.ts のメッセージ型は変更されていない
    And   その理由（offscreen.ts 内に閉じた実装詳細、SW非関知）がドキュメントに明記されている
```

```gherkin
Feature: Offscreen/OPFS メッセージング契約の可視化

  Scenario: SW↔offscreen の注入経路がドキュメントに記載されている
    Given 知識グラフで sqliteClient.ts が孤立ノードとして検出されている
    When  docs/ に Offscreen/OPFS アーキテクチャ図を追記する
    Then  SW → sendMessage(SQLITE_*) → offscreen.ts → (Worker へ委譲 or 直接処理) の
          経路が図示されている
    And   offscreen↔Worker 間は別チャネル（Worker.postMessage）であり
          型定義が独立している旨が明記されている
```

## 受け入れ基準
- [ ] `src/messaging/sqliteMessages.ts` に SW↔offscreen 間の SQLite メッセージ型が discriminated union として定義されている
- [ ] `sqliteClient.ts` が `src/messaging/sqliteMessages.ts` の型をimportし、文字列リテラル直書きを廃止している
- [ ] `offscreen.ts` が同じ型をimportし、if-elseチェーンが型安全な形（switch + discriminated union、または型ガード関数）に置き換わっている
- [ ] 存在しないメッセージ型を送信するコードが型チェックでエラーになることを確認する
- [ ] 未知の type を受信した場合にログ記録のうえクラッシュしないことをテストで担保する
- [ ] opfsWorker.ts のメッセージ型は変更されていない（意図的にスコープ外）
- [ ] Offscreen/OPFS のメッセージング経路図がドキュメントに追加されている

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外（ロジックはSW↔offscreen間のメッセージパッシングであり、統合テストで十分にカバーできる）

### 統合テスト
- `sqliteClient.ts` が送信したメッセージを `offscreen.ts` の `handleOffscreenMessage` が正しくディスパッチすることを確認するテスト（既存の `offscreen.ts` 単体テストを拡張）
- 未知の `type` を送信した場合に例外を投げずログ記録されることを確認するテスト

### 単体テスト
- `src/messaging/sqliteMessages.ts` の型ガード関数（もし追加する場合）の境界値テスト
- 各メッセージ型のペイロード形状が期待通りであることの型レベルテスト（`tsd` 等は未導入のため、コンパイル可否で代替）

## 実装アプローチ
- **Outside-In**: まず `offscreen.ts` の統合テストを拡張し、型安全化後も既存の動作が壊れていないことを先に固定してから型定義を導入する
- **Red-Green-Refactor**: 型導入前後で既存テストがグリーンのまま保たれることを都度確認する
- **リファクタリング**: if-elseチェーンを switch 文 + discriminated union に置き換えた後、20分岐の可読性が改善されたか確認する

## 見積もり
5pt（型定義の新規作成＋2ファイルの書き換え＋既存テストの回帰確認）

## 技術的考慮事項
- 依存関係: [[2026-07-16-04-fix-adr014-file-references]] とは独立。[[2026-07-16-06-fix-idb-fallback-subframe7536-migration]] とも独立（異なるファイルを対象とするため並行着手可能）
- テスタビリティ: `offscreen.ts` の `handleOffscreenMessage` は既にテスト用にexportされている（`bee2282 feat(offscreen): extract handleOffscreenMessage for testability`）ため、モックの追加改修は小さく済む見込み
- 非機能要件: 型定義の追加によるバンドルサイズ増加は無視できる範囲（型のみでランタイムコード無し）

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
grep -n "SQLITE_" src/background/sqliteClient.ts | wc -l
grep -n "msg.type ===" src/offscreen/offscreen.ts
cat src/messaging/types.ts | head -30
```

### 実装手順
1. `src/messaging/sqliteMessages.ts` を新規作成し、`SQLITE_*` の discriminated union（例: `type SqliteMessage = { type: 'SQLITE_INIT' } | { type: 'SQLITE_INSERT'; payload: ... } | ...`）を定義する。既存の `src/messaging/types.ts` の型ガード関数パターン（`isMaskedItem` 等）を参考にする
2. `sqliteClient.ts` の各 `this.call('SQLITE_XXX', ...)` 呼び出しを新しい型を使う形に置き換える
3. `offscreen.ts` の if-else チェーンを `switch (msg.type)` + discriminated union に置き換える。default ケースで未知 type をログ記録する
4. 既存の `offscreen.ts` 単体テストを実行し、リグレッションがないことを確認する
5. Offscreen/OPFS のメッセージング経路図（SW → offscreen → Worker の2チャネル、境界の違い）を `dev-docs/` 配下に追記する

### 落とし穴
- `offscreen.ts` の一部の `SQLITE_*` ハンドラは Worker へ委譲せず offscreen.ts 内で直接処理している（`sqliteEngineContext` 呼び出し）。型定義を作る際、Worker委譲の有無に関わらず SW↔offscreen 間の型は同じ discriminated union に含めること
- opfsWorker.ts 側のリネームや型統一を「ついでに」行わないこと。スコープ外と明記した理由（実装詳細・SW非関知）を無視した変更は後続PBIとの重複作業になる

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `sqliteClient.ts` / `offscreen.ts` の両方が単一の型ソースをimportしている
- [ ] コードレビュー完了
- [ ] Offscreen/OPFSメッセージング経路図がドキュメントに追加されている
