# PBI: messaging・uBlock 型ドリフト返済 — `PayloadForType` の `never` バグと `UblockRules` 同名衝突の解消

## ユーザーストーリー
messaging レイヤと uBlock 機能を保守する開発者として、`PayloadForType<'TEST_OBSIDIAN'>` / `<'DASHBOARD_SQLITE'>` が `never` に解決される型ユーティリティのバグと、構造非互換な 2 つの `interface UblockRules` が同名で存在する状態を解消したい、なぜなら 2026-09-07 のテスト型債務返済中に、型安全メッセージング API（`sendServiceWorkerMessage` 等）が optional payload を持つメッセージの payload をコンパイル時に検証できず、`messaging-types-uniformity.test.ts` が `as unknown as` で型アサートを空洞化させ、uBlock のテストが `parseUblockFilterList(text) as unknown as UblockRules` という「型が現実を表現できていない」サインを出しているから

## 優先度
- 順位: 06 / 7
- RICEスコア: **2.25**（Reach=3 / Impact=1 / Confidence=75% / Effort=1.0人週）
- 根拠: 2026-09-07 のテスト型債務返済中に発見。発見時の 5 件のうち実作業が発生するのは 2 件（`PayloadForType` の `never` バグ、`UblockRules` 同名衝突）で、3 件は調査の結果ドリフトなし or 既存コメントで足りると判明。型安全性の穴だがエンドユーザー影響はなく、緊急でない。

## 背景 / 5 件の判定結果

| # | 発見時の主張 | 判定 | アクション |
|---|-------------|------|-----------|
| 1 | `PayloadForType<'TEST_OBSIDIAN'>` / `<'DASHBOARD_SQLITE'>` が `never` に解決される | **型定義のバグ**（`PayloadForType` が optional payload を扱えない） | 修正 |
| 2 | `extractMainContent()` は Document 引数を取らないのにテストが渡している | **対応不要**（テストは既に引数なし呼び出しに追随済み、設計意図も `contentExtractor/index.ts:13-20` に文書化済み） | クローズ |
| 3 | `markdownFormatter.test.ts` の fixture に `tokens_used` / `content_length` が残存 | **対応不要**（両語は src 全体でヒットゼロ、fixture は現行 `BrowsingLogEntry` 準拠） | クローズ |
| 4 | `MaskedItem.original` 必須化、テストが `as unknown as MaskedItem` キャスト | **現状維持 + コメント**（型定義は正しい、キャストは「strip 関数が original 欠損を防御的に処理できるか」を検証する正当な用途、コメントも `piiStripper.test.ts:48,142` に既にある） | 任意で `isMaskedItem` ガード厳格化 |
| 5 | `UblockRules` が 2 つの非互換インターフェース、テストで `as unknown as` ブリッジ | **型 rename すべき**（本番実害は小、テストの正直さの問題） | 修正 |

### 項目 1 詳細（`PayloadForType` バグ）

- 定義: `src/messaging/types.ts:271-278`
  ```ts
  export type PayloadForType<T extends ExtensionMessage['type']> = Extract<
    ExtensionMessage, { type: T }
  > extends infer U
    ? U extends { payload: infer P } ? P : never
    : never;
  ```
- `TestObsidianMessage`（`src/background/messageTypes.ts:89-92`）は `payload?: { apiKey?: string }`（**optional**）、`DashboardSqliteMessage`（`:159-162`）も `payload?: DashboardSqliteRequest`（optional）
- optional プロパティは `U extends { payload: infer P }`（payload 必須の制約）にマッチせず `P` は推論されず `never` に解決される（TypeScript の仕様どおりの挙動）
- 対照的に `ValidVisitMessage` などは `payload:`（必須）なので正しく解決される
- テスト実害: `messaging-types-uniformity.test.ts:106-113`（`TEST_OBSIDIAN payload type should allow optional apiKey`）と `:121-126`（`DASHBOARD_SQLITE`）は、本来 `const payload: Payload = { apiKey: 'secret' }` と書きたいところを `as { apiKey?: string }` / `as unknown as Payload` に退避しており、payload 形状の型アサートが空洞化している
- `isServiceWorkerRequest` 型ガード（`types.ts:212-214`）は `TEST_OBSIDIAN` の object payload を許容するのに `PayloadForType` は表現できない — **この不整合が「ドリフト」の核心**
- 修正案: `U extends { payload?: infer P }` に変更。ただし payload を持たないメンバー（`CheckDomainMessage` 等、`payload` キー自体が無い）で `P` が `unknown` になる問題があるため、`[P] extends [undefined] ? never : P` や `'payload' extends keyof U ? ... : never` の分岐が要る。**実装時に型パズルの検証が必要**
- 影響: 本番型が変わる（`sendServiceWorkerMessage` / `sendFromContentScript` / `sendFromPopup` の `payload?: PayloadForType<T>` 引数）。実行時挙動は不変。`src/messaging/dashboardGateway.ts:37` は `sendFromPopup` を使わず直接 `chrome.runtime.sendMessage` するので影響限定的だが要確認。現状 grep で `sendFromPopup('TEST_OBSIDIAN', <payload>)` の payload 付き呼び出しは見つからず（payload は将来用の可能性）

### 項目 5 詳細（`UblockRules` 同名衝突）

- **A. `src/utils/types.ts:77-86`**（`ublockMatcher` / ストレージ保存用、軽量形式）
  ```ts
  interface UblockRules {
    blockDomains: string[];
    exceptionDomains: string[];
    blockRules?: UblockRule[];      // 旧形式互換
    exceptionRules?: UblockRule[];
    metadata?: { importedAt: number; ruleCount: number };
  }
  ```
- **B. `src/utils/ublockParser/transform.ts:24-33`**（`parseUblockFilterList` の返り値、パース中間形式）
  ```ts
  interface UblockRules {
    blockRules: UblockRule[];       // 必須
    exceptionRules: UblockRule[];   // 必須
    metadata: { source; importedAt; lineCount; ruleCount };  // 必須、形状が A と違う
  }
  ```
- 非互換: A は `blockDomains` 必須 / B には無い、B は `blockRules` 必須 / A は任意、`UblockRule` の中身が別物（A: `{domain}` 中心の緩い型 / B: `{id, rawLine, pattern, ...}` の厳格な型）、`metadata` の形状違い
- テストのブリッジ: `src/utils/__tests__/ublockMatcher.test.ts:9-13`
  ```ts
  function rulesFromText(text: string): UblockRules {
    return parseUblockFilterList(text) as unknown as UblockRules;
  }
  ```
- **本番の状況（重要）**: `isUrlBlocked` / `buildIndex`（`ublockMatcher.ts:47-88`）は実行時に A 形式（`blockDomains`）優先・無ければ B 形式（`blockRules`）にフォールバックの両対応ロジックを持つ（`:52-53` `shouldProcessBlockRules`）。本番の呼び出し `src/utils/domainUtils.ts:114-118` は `settings[StorageKeys.UBLOCK_RULES]`（= ストレージ、A 形式）を渡す。`parseUblockFilterList` の生出力を `isUrlBlocked` に直接渡す本番経路は無い（ダッシュボードは `parseUblockFilterListWithErrors` → `rulesBuilder` で A 形式に変換してから保存）。よって `as unknown as` ブリッジが必要なのは**テストだけ**
- 修正案（推奨: 選択肢 1）: **B の型を rename**（例 `ParsedUblockRuleset`）。`transform.ts` / `ublockParser/index.ts:239` の返り値型を変更。本番ロジック不変、型名のみ。影響: `ublockParser` 配下のテスト群
- 選択肢 2（別 PBI 推奨）: `ublockMatcher` が受け取る型を明示的 union（`LightweightUblockRules | LegacyUblockRules`）にして両対応ロジックを型で表現。`isUrlBlocked` の公開型が変わるので影響大

## BDD受け入れシナリオ

### Scenario: optional payload を持つメッセージの payload 型が正しく解決される
  Given `TEST_OBSIDIAN` は `payload?: { apiKey?: string }` を定義している
  When `PayloadForType<'TEST_OBSIDIAN'>` を型レベルで評価する
  Then `{ apiKey?: string }`（または `{ apiKey?: string } | undefined`）に解決され、`never` ではない
  And `messaging-types-uniformity.test.ts` の該当ケースが `as unknown as` なしで `const payload: PayloadForType<'TEST_OBSIDIAN'> = { apiKey: 'x' }` と書ける

### Scenario: payload を持たないメッセージは引き続き never に解決される
  Given `CHECK_DOMAIN` は payload を持たない
  When `PayloadForType<'CHECK_DOMAIN'>` を型レベルで評価する
  Then `never` に解決される（`unknown` に退化しない）
  And `messaging-types-uniformity.test.ts` の no-payload 一様性アサート（`const assertNever: never = 1 as Payload`）が全 no-payload 型で通る

### Scenario: 不正な payload 形状がコンパイルエラーになる
  Given `PayloadForType` が修正されている
  When `sendFromPopup('TEST_OBSIDIAN', { wrongKey: 1 })` と書く
  Then TypeScript がコンパイルエラーを出す（現状は `never` 型なので `as unknown as` でしか渡せず、タイポが素通りする）

### Scenario: 2 つの UblockRules が別名で区別される
  Given `src/utils/types.ts` と `src/utils/ublockParser/transform.ts` に同名の `interface UblockRules` がある
  When `ublockParser` 側の型を `ParsedUblockRuleset`（仮）に rename する
  Then `parseUblockFilterList` の返り値型が `ParsedUblockRuleset` になり、`ublockMatcher.test.ts` のヘルパから `as unknown as` ブリッジが不要になる（または不要にできることが型で確認できる）
  And uBlock 機能の全既存テストが green を維持する（本番ロジック不変）

## 受け入れ基準
- [x] `PayloadForType<T>` が optional payload メンバー（`TEST_OBSIDIAN` / `DASHBOARD_SQLITE`）で実 payload 型に解決される
- [x] `PayloadForType<T>` が no-payload メンバーで `never` に解決される（`unknown` 退化なし）
- [x] `messaging-types-uniformity.test.ts:106-126` の `as` / `as unknown as` 退避が本来の型アサートに戻る
- [x] `isServiceWorkerRequest` 型ガードと `PayloadForType` の整合が取れている（ガードが受け入れる payload を型も表現できる）
- [x] 全 `sendServiceWorkerMessage` / `sendFromContentScript` / `sendFromPopup` の呼び出しが `npm run type-check` を通る
- [x] `ublockParser` 側の `UblockRules` が別名に rename され、`ublockMatcher.test.ts` の `as unknown as` ブリッジが除去（またはコメントで「両対応ロジックの型表現は別 PBI」と明記）
- [x] 項目 2・3 を「調査の結果ドリフトなしと確認」として本 PBI 内にクローズ記録
- [x] `npm run validate` と `npm run type-check:test` が exit 0
- [x] uBlock / messaging の既存テストが全て green（実行時挙動不変）

## テスト戦略

### 単体テスト（Outside-In: 型テスト先行）
- `messaging-types-uniformity.test.ts` に「optional payload 型は実 payload 型に解決される」ケースを追加（Red）→ `PayloadForType` を修正（Green）
- no-payload 一様性アサートが引き続き通ることを確認（回帰防止）
- `ublockParser` の rename 後、`parseUblockFilterList` の返り値型を型テストで固定

### 統合テスト
- なし（型・テストのみの変更。API 境界の振る舞いは不変）

### E2Eテスト
- なし

## 実装アプローチ
1. `messaging-types-uniformity.test.ts` に optional payload の型テストを追加（Red）
2. `PayloadForType` を optional payload 対応に修正。no-payload メンバーで `unknown` が漏れないことを型パズルで検証（`exactOptionalPropertyTypes` 有効に注意）
3. 全 `sendXxx` 呼び出しのコンパイルを通す。`dashboardGateway.ts:37` 等の直接 `chrome.runtime.sendMessage` 経路への影響を確認
4. `messaging-types-uniformity.test.ts:106-126` の `as` 退避を本来のアサートに戻す
5. `isServiceWorkerRequest`（`types.ts:212-214`）との整合確認
6. `ublockParser` 側の `UblockRules` を `ParsedUblockRuleset`（仮）に rename。`transform.ts` / `ublockParser/index.ts:239` / `ublockParser` 配下テストを更新
7. `ublockMatcher.test.ts:9-13` の `as unknown as` ブリッジを除去（または「union 化は別 PBI」とコメント）
8. 項目 2・3 のクローズ記録を PBI 完了メモに追記
9. 任意: `isMaskedItem` の `original` チェックを型定義（必須）と揃える

## 見積もり
2ポイント（1.0 人週。項目 1 の型パズル検証と全 `sendXxx` 呼び出しのコンパイル通しが主。項目 5 の rename は機械的だが `ublockParser` 配下テストへの波及あり）

## 実装者向け注記
- 項目 1 の型パズル: optional payload メンバーと no-payload メンバー（`payload` キー自体が無い）の共存で `unknown` が漏れないよう慎重に。候補実装:
  ```ts
  type PayloadForType<T extends ExtensionMessage['type']> =
    Extract<ExtensionMessage, { type: T }> extends infer U
      ? U extends { payload?: infer P }
        ? [P] extends [undefined] ? never : Exclude<P, undefined>
        : never
      : never;
  ```
  （この形が正解かは要検証。`'payload' extends keyof U` 分岐も候補）
- 項目 5 rename の最終確認: 本番経路がすべて A 形式（`blockDomains`）に変換してから保存していることを確認（特に `src/utils/migration/legacyMigration.ts`, `legacyResync.ts` が `parseUblockFilterList` 出力を直接保存していないか）
- `ublockMatcher` の公開型を union に広げる案（選択肢 2）は影響が大きいので**別 PBI に分離**推奨。本 PBI は rename に留める
- いずれも実行時挙動は不変。型・テストのみの変更
- `@ts-ignore` / `@ts-expect-error` の新設禁止（型を正す）

## 未解決事項
1. `PayloadForType<'TEST_OBSIDIAN'>` が `never` なのは意図的か → 調査結論: **意図的ではない**（`payload?: { apiKey?: string }` を明示定義しているので `sendFromPopup('TEST_OBSIDIAN', { apiKey })` と書けるべき）。ただし本番で `TEST_OBSIDIAN` / `DASHBOARD_SQLITE` に payload を渡す経路が実在するか要確認（現状 grep では未発見、将来用の可能性）
2. `messaging-types-uniformity.test.ts` の "uniformity" が意味するのは「no-payload はすべて `never`」なのか「payload 型がメッセージ定義と一致」なのか → 両方。optional payload という第 3 のケースを設計時に想定しておらず、テストのアサート戦略（`never` か「必須フィールドを持つ」の二択）が optional payload を表現できていない。項目 1 修正時に「optional payload 型は `{ apiKey?: string } | undefined` に解決される」ケースを正しく追加する必要
3. `UblockRules` rename の最終確認: migration 系（`legacyMigration.ts` 等）が `parseUblockFilterList` 出力を直接保存していないか
4. `isMaskedItem` 厳格化を含めるか（型定義は `original` 必須、ガードは `:60-62` で「あれば string」の緩いチェック。設計意図を尊重するならガード側を厳格化が筋。項目 4 の本体とは別の小改善）

## Definition of Done
- [x] `PayloadForType` 修正 + `messaging-types-uniformity.test.ts` の型アサート復元 + `isServiceWorkerRequest` 整合確認
- [x] `ublockParser` 側の `UblockRules` rename
- [x] 項目 2・3 のクローズ記録
- [x] `npm run validate` / `npm run type-check:test` exit 0
- [ ] コードレビュー完了

## 実装メモ（2026-09-07 実施）

### 最終的な `PayloadForType` の型定義（`src/messaging/types.ts`）

```ts
export type PayloadForType<T extends ExtensionMessage['type']> = Extract<
  ExtensionMessage,
  { type: T }
> extends infer U
  ? 'payload' extends keyof U
    ? U extends { payload?: infer P }
      ? [P] extends [undefined]
        ? never
        : Exclude<P, undefined>
      : never
    : never
  : never;
```

- PBI 候補実装に `'payload' extends keyof U` 分岐を追加した。候補のままでは payload キー自体が無いメンバーが `{ payload?: infer P }` に `P = unknown` でマッチし `unknown` に退化するため。
- `Exclude<P, undefined>` は `exactOptionalPropertyTypes: true` 下で optional 推論に混入する `undefined` の除去が目的。
- 検証: 正直な型アサート追加後に旧定義で `type-check:test` が 9 エラー（Red）→ 新定義で exit 0（Green）。`sendFromPopup('TEST_OBSIDIAN', { wrongKey: 1 })` が `TS2353` コンパイルエラーになることを一時ファイルで確認（BDD Scenario 3 達成、ファイルは削除済み）。

### 項目 2・3 クローズ記録（調査の結果ドリフトなしと確認）

- 項目 2: テストは引数なし呼び出しに追随済み、設計意図も `contentExtractor/index.ts:13-20` に文書化済み。変更なしでクローズ。
- 項目 3: `tokens_used` / `content_length` は src 全体でヒットゼロ、fixture は現行 `BrowsingLogEntry` 準拠。変更なしでクローズ。

### 項目 4: `isMaskedItem` 厳格化は見送り

- ガード変更は実行時挙動に触れるため「型とテストのみ」スコープから除外。型定義は正しくキャストも正当用途のため現状維持。

### 未解決事項の結論

1. `TEST_OBSIDIAN` / `DASHBOARD_SQLITE` に payload を渡す本番経路：`sendFromPopup('TEST_OBSIDIAN', <payload>)` 形式の呼び出しは grep で未発見（将来用）。`dashboardGateway.ts:37` は直接 `chrome.runtime.sendMessage` 経路で `PayloadForType` の影響を受けず、`type-check` でコンパイル確認済み。
2. uniformity の意味：required / optional / absent の3状態を型テストで表現できるようになり解決。旧 `TEST_OBSIDIAN ... should be never` テストは矛盾のため削除し、正直な optional テストに置換。
3. migration 系の最終確認：`src/background/migration/legacyMigration.ts` / `legacyResync.ts` は `parseUblockFilterList` を参照していない。本番は `rulesBuilder.rebuildRulesFromSources` で A 形式（`blockDomains`）に変換してから保存。ストレージ形式への影響なし。
4. `isMaskedItem` 厳格化：見送り（上記）。

### 残存ドリフト（別 PBI 候補、本 PBI スコープ外）

- a. `ACTIVITY_UPDATE` の不整合：型は `payload?: Record<string, never>`（`PayloadForType` は `Record<string, never>` に解決）だが、`NO_PAYLOAD_TYPES` / `isServiceWorkerRequest` は no-payload 扱い（`payload === undefined` 要求）。一方で本番 `recordSession.ts:333` / `encryptionSession.ts:351` は `payload: {}` を直送りし、ガード上は拒否される形。テストは正直な型に更新し、不整合解消は別 PBI とする。
- b. `ublockMatcher` の両対応ロジック（`blockDomains` 優先・`blockRules` フォールバック）の union 型表現（選択肢 2）。`ublockMatcher.test.ts` にコメント明記済み。
- c. 単数形 `UblockRule` もパーサ側とストレージ側で別形状のまま残存。今回 rename 対象外としたが、将来の混乱防止に rename 候補。
