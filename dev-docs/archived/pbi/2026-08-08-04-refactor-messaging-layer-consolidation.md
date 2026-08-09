# PBI: messaging 層の型付き送信・逆依存・整合性テストを整理する

**作成日**: 2026-08-08
**優先度**: 中
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（型の移動と送信経路の変更。実行時の振る舞いは不変を目標）
**種別**: 🔧非機能追加（refactor）

---

## 背景

アーキテクチャレビュー（2026-08-08）で、`src/messaging/` 層に4つの独立した問題が見つかった。

### 1. 型付き送信ヘルパーが完全な死蔵コード

```bash
grep -rn "sendServiceWorkerMessage\|sendFromPopup\|sendFromContentScript" src/ entrypoints/ | grep -v __tests__
# → 定義元 src/messaging/types.ts のみ。外部からの import は 0件
```

一方 `chrome.runtime.sendMessage` を直接呼ぶ非テストファイルは**20件**。判別共用体 `ExtensionMessage` は受信側（`VALID_MESSAGE_TYPES` の実行時チェック）しか守っておらず、**送信側は1箇所も型検査されていない**。

### 2. 中立層が background 層に依存（逆向き）

```typescript
// src/messaging/types.ts:106-107
import { CURRENT_PROTOCOL_VERSION, VALID_MESSAGE_TYPES, NO_PAYLOAD_TYPES } from '../background/messageTypes.js';
import type { ExtensionMessage } from '../background/messageTypes.js';
```

`messaging/` は全層（popup / dashboard / content / offscreen / background）が参照する中立層のはずが、`background/` に依存している。commit `35658c9` で `protocol.ts` を中立化した作業の続き。

さらに `messageTypes.ts:22` が `protocol.ts` の `CURRENT_PROTOCOL_VERSION` を「後方互換のため」再エクスポートしており、**同じ定数に2つの import 経路**がある。

### 3. 整合性テストが最新の型を見ていない

- `ResponseForType`（`messaging/types.ts`）は19分岐で `LOG_FORWARD` を欠く
- `src/background/__tests__/message-types-consistency.test.ts:8-15` のリストも `LOG_FORWARD` を欠く

**整合性を守るはずのテストが、守るべき対象を手書きで複製しているため最新型を見落としている。**

### 4. GET_CONTENT の位置づけが曖昧

`GET_CONTENT` は `ExtensionMessage` と `VALID_MESSAGE_TYPES` にあるが、`registry.register('GET_CONTENT', ...)` が存在しない。

**調査の結果、これはバグではない**：`GET_CONTENT` は `chrome.tabs.sendMessage` で content script（`src/content/extractor.ts:747`）へ送られるメッセージであり、Service Worker は受信しない。送信元は `src/popup/recordCurrentPage.ts:459` と `src/popup/statusPanel.ts:53`。

しかし `VALID_MESSAGE_TYPES` の docコメントは「Service Worker が**受信**するリクエストの集合」と明記している。SW が受信しない `GET_CONTENT` がそこに含まれているのは**定義と実態の不一致**であり、将来の誤解を招く。

### 削除テスト

- 型付き送信ヘルパー: 削除すると複雑度は**移動しない**（誰も使っていない）。ただし「送信側も型で守る」という設計意図は正しいため、**削除ではなく採用**が本筋
- `ResponseForType` の手書き分岐: `VALID_MESSAGE_TYPES` から導出すれば**複雑度が集中する**

---

## 実装者向け注記: 現状の確認

```bash
# 生の sendMessage 呼び出し元（20ファイル）
grep -rln "chrome.runtime.sendMessage" src/ entrypoints/ | grep -v __tests__

# LOG_FORWARD の欠落箇所
grep -n "LOG_FORWARD" src/messaging/types.ts src/background/__tests__/message-types-consistency.test.ts

# CURRENT_PROTOCOL_VERSION の import 経路
grep -rn "CURRENT_PROTOCOL_VERSION" src/ | grep -v __tests__
```

---

## 設計

### 方針: スコープを分けて段階実施

20ファイルの送信経路を一斉に型付きヘルパーへ移すのは変更量が大きく、回帰リスクが高い。**本PBIでは「型で守れる土台を整える」ところまでを対象とし、全面移行は行わない**（YAGNI／段階的移行）。

| # | 対応 | 本PBIで実施 |
|---|---|---|
| 1 | `ResponseForType` に `LOG_FORWARD` を追加 | ✅ |
| 2 | 整合性テストのリストを `VALID_MESSAGE_TYPES` から**導出**に変更（手書き複製をやめる） | ✅ |
| 3 | `VALID_MESSAGE_TYPES` から `GET_CONTENT` を除外し、content script 向け型として分離 | ✅ 要検証 |
| 4 | `messaging/` → `background/` の逆依存を解消（型の実体を `messaging/` へ移す） | ✅ |
| 5 | 20ファイルの送信を型付きヘルパーへ全面移行 | ❌ 別PBI |

### #3 の検証が必須

`GET_CONTENT` を `VALID_MESSAGE_TYPES` から外すと、SW の実行時チェックで拒否されるようになる。**SW が本当に `GET_CONTENT` を受信しないことを確認してから外す**こと。確認方法:

```bash
# GET_CONTENT を chrome.runtime.sendMessage で送っている箇所があるか
grep -rn "GET_CONTENT" src/ | grep "runtime.sendMessage"
# → 0件であれば SW は受信しない
```

0件でない場合、または `NO_PAYLOAD_TYPES` / `messaging-types-uniformity.test.ts` が `GET_CONTENT` を前提にしている場合は、**#3 を見送り**、代わりに `VALID_MESSAGE_TYPES` の docコメントに「content script 向けも含む」と明記する方針に切り替える。判断は実装時にテスト結果で決める。

### #4 の方向

```
Before                          After
─────────────────────           ─────────────────────
messaging/types.ts              messaging/types.ts
  └→ background/messageTypes      └→ messaging/messageTypes（中立）
                                        ↑
                                  background/messageTypes.ts
                                    （再エクスポートのみ or 削除）
```

`messageTypes.ts` は241行あり、`AiTestProgress` 型（`aiClient.ts` 由来）も参照している。**丸ごと移動すると `messaging/` が `background/ai/` に依存して逆依存が再発する**。実装時に依存関係を確認し、循環が生じる場合は「移動する型」と「background に残す型」を分ける。

---

## 受け入れ基準（BDD）

```gherkin
Scenario: 整合性テストが型定義から導出される
  Given VALID_MESSAGE_TYPES が唯一の真実の源である
  When 新しいメッセージ型を追加する
  Then 整合性テストが手書きリストの更新なしに新型を検知する

Scenario: ResponseForType が全メッセージ型を網羅する
  Given ExtensionMessage に LOG_FORWARD が含まれる
  When ResponseForType<'LOG_FORWARD'> を解決する
  Then デフォルト分岐に落ちず専用の応答型が得られる

Scenario: messaging 層が background 層に依存しない
  Given messaging/ は全層が参照する中立層である
  When messaging/types.ts の import を確認する
  Then background/ からの import が存在しない

Scenario: 既存テストが全てパスする
  When 変更を完了する
  Then npm run validate が成功する
```

## 受け入れ基準

- [x] `ResponseForType` に `LOG_FORWARD` の分岐を追加
- [x] `message-types-consistency.test.ts` の手書きリストを型からの導出に変更
- [x] `GET_CONTENT` の位置づけを整理（**除外せず docコメントで明記**。判断根拠は下記）
- [x] `messaging/types.ts` から `background/` への import を解消 → **調査の結果、方針変更**（下記）
- [x] `CURRENT_PROTOCOL_VERSION` の二重 import 経路 → **現状維持と判断**（下記）
- [x] `npm run validate` が成功する

### 実装結果（2026-08-08）

#### `GET_CONTENT` は除外しない

調査の結果、**バグではなかった**。`GET_CONTENT` は `chrome.tabs.sendMessage` で content script（`src/content/extractor.ts:747`）へ送られるメッセージで、Service Worker は受信しない。送信元は `src/popup/recordCurrentPage.ts:459` と `src/popup/statusPanel.ts:53`。

`VALID_MESSAGE_TYPES` から外すと、popup 側の送信元と content script 側の受信側が共有している型契約が壊れる。**除外せず、なぜ registry に登録が無いのかをコメントで明記**した。

#### 整合性テストを導出方式に変更（本PBIの中核）

手書きリストを廃止し、型レベルの網羅性チェックに置き換えた:

```typescript
type Missing = Exclude<ValidType, (typeof VALID_MESSAGE_TYPES)[number]>;
const _noMissingTypes: Missing extends never ? true : never = true;
```

ただし**型レベルのチェックだけでは不十分だった**。vitest は実行時に型を消すため、`Missing extends never` が偽になってもテストは失敗しない。しかも `npm run type-check:test`（テストを含む型チェック）は本作業前から既に壊れており、`make test` にも含まれていない。

そこで**ソーステキストから union のメンバーを導出**して実行時に突き合わせる方式にした:

```typescript
// messageTypes.ts を読み、ExtensionMessage union のメンバー interface 名 →
// 各 interface の type: 'NAME' リテラルを引いて VALID_MESSAGE_TYPES と比較
function unionMemberTypeNames(): string[] { ... }
```

これで手書きリストを一切持たずに、`npm test` の実行時に取りこぼしを検出できる。

**検証**: `VALID_MESSAGE_TYPES` から `LOG_FORWARD` を実際に削除したところ、
`AssertionError: expected [ Array(19) ] to include 'LOG_FORWARD'` で失敗することを確認した（復旧済み）。型レベルのチェックのみだった版では**素通りしていた**。

#### `AiTestProgress` の重複定義を解消（PBI-02 で作ってしまった負債）

PBI-02 で `AIService.ts` に `AiTestProgress` を定義した際、`aiClient.ts` の既存定義と**重複**させてしまっていた。本PBIで `AIService.ts` を正本とし、`aiClient.ts` は再エクスポートに変更。

さらに `messageTypes.ts`（全レイヤーが参照）の import 先を `aiClient.js` から `ai/AIService.js` に変更した。`aiClient.js` 経由だと provider Strategy のグラフ全体を引きずるため。

#### `messaging/types.ts` → `background/messageTypes.ts` の逆依存は現状維持

当初は「型の実体を `messaging/` へ移す」方針だったが、調査により**費用対効果が合わないと判断**した。

- `messageTypes.ts` は 19ファイルから import されている
- 移動すると19ファイルすべての import 文を書き換える必要がある
- 実行時の振る舞いは何も変わらない（型のみ）
- `messageTypes.ts` 自体は `AiSummaryCleansedReason`（`utils/commonTypes.js`）と `AiTestProgress`（`ai/AIService.js`）しか import しておらず、循環はしていない

**代わりに実施した実質的な改善**: `messageTypes.ts` の import 先を `aiClient.js`（重い実装モジュール）から `ai/AIService.js`（型のみ）へ変更し、依存の重さを下げた。

#### `CURRENT_PROTOCOL_VERSION` の二重経路も現状維持

`messageTypes.js` 経由が17ファイル、`messaging/protocol.js` 経由が4ファイル。再エクスポートを削除すると17ファイルの変更が必要だが、`messageTypes.ts` 側には既に「正本は `messaging/protocol.ts`」というコメントがあり、意図は明示されている。振る舞いも変わらないため、17ファイルを触る価値はないと判断した。

## テスト戦略

### 単体テスト
- 整合性テスト: `VALID_MESSAGE_TYPES` の全要素が `ExtensionMessage` の union に存在すること（導出型で検証）
- `ResponseForType`: 全メッセージ型で `never` に落ちないこと

### 回帰テスト
- `src/__tests__/messaging-types-uniformity.test.ts`（`GET_CONTENT` の payload 型を検証している）
- `src/messaging/__tests__/types.test.ts`
- `src/background/__tests__/service-worker-message-validation.test.ts`（426行）

## 実装アプローチ

1. `ResponseForType` に `LOG_FORWARD` を追加（最小・独立）
2. 整合性テストを導出型に書き換え（これで以後の型追加漏れが構造的に防げる）
3. `GET_CONTENT` の実態を grep で確認し、除外可否を判断
4. `messaging/` の逆依存を解消（循環に注意しつつ型を移動）
5. `CURRENT_PROTOCOL_VERSION` の再エクスポートを削除し import を1本化
6. 各ステップで `npm run validate`

## 見積もり
2pt（型の移動は依存関係の確認が必要。20ファイルの全面移行は含まない）

## 技術的考慮事項

- `src/content/loader.ts` は content script entrypoint のため ESM static import が使えず `CURRENT_PROTOCOL_VERSION` の値をハードコードしている（`protocol.ts:11-13` のコメントに記録済み）。この意図的な重複は**維持する**
- `messageTypes.ts` は `aiClient.ts` から `AiTestProgress` を type import している。移動時に `messaging/` → `background/ai/` の逆依存を作らないよう注意
- 型付きヘルパーの全面移行（#5）は別PBIとする。20ファイル・34箇所の変更となり、本PBIと混ぜるとレビュー不能になる

## 関連

- アーキテクチャレビュー（2026-08-08）小粒指摘
- 先行作業: commit `35658c9`（`protocol.ts` の中立化）
- 対象: `src/messaging/types.ts`, `src/background/messageTypes.ts`, `src/background/__tests__/message-types-consistency.test.ts`
