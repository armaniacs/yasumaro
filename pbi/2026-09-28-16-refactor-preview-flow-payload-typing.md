# PBI: popup record payload の型を wire 契約から導出

## ユーザーストーリー

保守者として、popup の record payload を wire 契約の型から直接導出したい。なぜなら 3 payload が `Record<string, unknown>` として 3 度書かれ、契約に無いフィールドが誤搬送できてしまうからだ。

## ビジネス価値

- payload スキーマの単一情報源化により、background 側の契約（`messageTypes.ts`）と popup 側の送信内容の間で型の乖離をコンパイル時に検出できるようにする。
- `as unknown as ExtensionMessage` による型契約の二重キャストを排除し、送信経路の型保証を復元する。
- defense-in-depth 方針（`validators.ts` の unknown-key 厳格化）が採用された場合に、runtime 破綻が起きないことを型で保証する。
- 進行中のマスターパスワード re-encrypt PBI と競合しない領域であり、並列実装が可能である。

## 優先度

- 種別: refactor
- 順位: 16 / 17
- RICEスコア: 2.4（Reach=2 / Impact=2 / Confidence=90% / Effort=1.5 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: 送信 payload の型が wire 契約から導出される
  Given MANUAL_RECORD / PREVIEW_RECORD / SAVE_RECORD の payload が Record<string, unknown> として手書きされている
  And 本物の契約は src/background/messageTypes.ts:92-105 に定義されている
  When buildRecordPayload の戻り値型を定義し直す
  Then 各 op の payload 型が messageTypes.ts の契約から抽出された型と一致する
  And Record<string, unknown> への手書き記述と二重キャストが残っていない

Scenario: 契約に無いフィールドを誤搬送できない
  Given SAVE_RECORD のみが maskedCount? を持ち、他の op は持たない
  When ある op の payload を構築する
  Then その op が持たないフィールド（maskedCount など）は型エラーとして検出される
  And buildRecordPayload の pickDefined が op の payload キーに制限されている

Scenario: refactor 後も送信されるメッセージの観測挙動が不変である
  Given 3 op それぞれについて送信される message の type と payload キー集合の baseline を記録した
  When 型のみを変更し、送信ロジックの順序・条件・retries を変えない
  Then 送信される type と payload のキー集合・値が baseline と一致する
  And retries: 5（previewFlow.ts:85）が維持されている
```

## 受け入れ基準

- [ ] `src/popup/recordCurrentPage/previewFlow.ts:8-11` の `RecordMessage` 型が削除され、契約を `src/background/messageTypes.ts:92-105` から抽出した型が payload スキーマの SSOT になっている。
- [ ] `buildRecordPayload`（`previewFlow.ts:59-81`）の戻り値型が `PayloadForType<Op>` に対して型付けされ、`pickDefined`（`:79`）が op の payload キーに制限され、maskedCount がその op に属さない場合に載らないことが保証されている。
- [ ] `messageTransport.send`（`:85`）の `as unknown as ExtensionMessage` が解消され、`src/messaging/messageTransport.ts` の send シグネチャ（`send<T extends 'MANUAL_RECORD'|'PREVIEW_RECORD'|'SAVE_RECORD'>(m: Extract<ExtensionMessage, { type: T }>)`）が既存ジェネリクス・オーバーロードと整合している。
- [ ] `ByteStatsPayload`（`src/background/messageTypes.ts:92-105`）の op 間必須 / 任意差（maskedCount? は SAVE_RECORD のみ）が型で表現され、未知の message type がコンパイル時に拒否されることを確認している。
- [ ] 既存テストのうち `Record<string, unknown>` を前提にしている箇所の型更新（pin 更新）が必要か確認し、反映している。
- [ ] マスターパスワード re-encrypt PBI（`2026-09-27-fix-master-password-reencrypt-preserve-api-keys.md`）と競合しない、`2026-09-28-14`（messageTypes.ts の runtime 定数移設）との型参照の整合を保っている。
- [ ] 観測挙動（送信 type・payload のキー集合と値・`retries: 5`）が不変である。
- [ ] 既存のビルド、テスト、ユーザーに観測される動作に回帰がない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- popup から「現在のページを記録」およびプレビューを実行し、background 側が受信する type と payload のキー集合・値が refactor 前 baseline と一致することを確認する。
- 3 op（MANUAL_RECORD / PREVIEW_RECORD / SAVE_RECORD）それぞれについて、送信される type と payload を確認する。
- 送信失敗時のリトライ挙動（`previewFlow.ts:85` の `retries: 5`）が baseline と一致することを確認する。
- 新しいユーザー機能は追加せず、「送信されるメッセージの観測挙動が不変である」ことを Outside-In の観測点とする。

### 統合テスト

- `buildRecordPayload`（`previewFlow.ts:59-81`）が op を受け取り、その op の payload 型に整合したオブジェクトを返すことを確認する。
- `messageTransport.send` の呼び出しが `Extract<ExtensionMessage, { type: T }>` と整合し、runtime 定数の実値（`messageTypes.ts`）と type 側が同期していることを確認する。
- maskedCount（SAVE_RECORD のみ）を含むケースと含まないケースで、生成される payload が `ByteStatsPayload`（`messageTypes.ts:92-105`）の op 間必須 / 任意差に従うことを確認する。
- `src/messaging/messageTransport.ts` の既存ジェネリクス / オーバーロードの利用箇所が、send 拡張後もコンパイルと型推論の期待どおり動作することを確認する。
- `validators.ts` が unknown-key 厳格化を採った場合に、popup が送る payload が strict 検証を通過することを確認する（現状は required field のみ検査のため、破綻は未顕在化）。

### 単体テスト

- `buildRecordPayload` について、3 op × 代表入力（maskedCount あり / なし、force / skipAi あり / なし）で生成されるキー集合を table-driven に検証する。
- `pickDefined` が op の payload キーに制限されていることを、型と実行時の両面から検証する。
- `src/messaging/messageTransport.ts` の send ジェネリクスが、未知の type を拒否し、既知の 3 type を受理することの型テストを（型レベルまたはコンパイル fixture で）確認する。
- 現状、送信 payload のキー集合を pin する型テストは存在しないため、pin の新設が必要かを確認する。

## 実装アプローチ

- **Outside-In**: 先に、3 op それぞれが送信する type と payload のキー集合・値を baseline としてテストで pin し、既存テストの型前提を確認してから型変更に入る。
- **Red-Green-Refactor**: 型を厳密化してコンパイルエラーが出た箇所を直し、`npm run validate` を通してから実行時ロジックを一切触らない。
- **RecordMessage の削除**: `previewFlow.ts:8-11` の手書き型を削除し、契約を `src/background/messageTypes.ts:92-105` から抽出する。送信のたびに `PayloadForType<Op>` で型付けする。
- **send の generic 化**: `send<T extends 'MANUAL_RECORD'|'PREVIEW_RECORD'|'SAVE_RECORD'>(m: Extract<ExtensionMessage, { type: T }>)` を、既存の messageTransport の send シグネチャ（既存ジェネリクス・オーバーロード）と整合させる。
- **buildRecordPayload の型付け**: 戻り値を `PayloadForType<Op>` に対して型付けし、`pickDefined`（`previewFlow.ts:79`）を op の payload キーに制限する。
- **二重キャストの解消**: `previewFlow.ts:85` の `as unknown as ExtensionMessage` を消滅させる。
- **型のみの変更**: 実行ロジック（送信順序・条件・retries: 5）は変更しない。
- **競合回避**: マスターパスワード re-encrypt PBI は settings / storage 系で `messageTypes.ts` を触らないため競合しない。`2026-09-28-14` は `messageTypes.ts` の runtime 定数移設のみなので、型参照を維持する。

## 見積もり

**1.5 SP**

型定義の削除と再定義、`messageTransport.send` のシグネチャ整合（既存ジェネリクス / オーバーロードの確認）、`buildRecordPayload` の型付けと `pickDefined` のキー制限、二重キャスト解消、既存テストの型前提更新、3 op の parity pin を含む。型のみの変更だが、`send` シグネチャが messaging 層の共有経路であるため影響範囲の確認に時間がかかる点が上振れ要因となる。

## 技術的考慮事項

- `src/popup/recordCurrentPage/previewFlow.ts:8-11` — `RecordMessage` 型が MANUAL_RECORD / PREVIEW_RECORD / SAVE_RECORD の payload を `Record<string, unknown>` で手書きしている。
- `src/popup/recordCurrentPage/previewFlow.ts:59-81` — `buildRecordPayload(...): Record<string, unknown>` がフィールド集合を 3 度目に記述している。`pickDefined` 経由で `:79` が maskedCount をどの op にも載せ得る。
- `src/popup/recordCurrentPage/previewFlow.ts:85` — `messageTransport.send(message as unknown as ExtensionMessage, { retries: 5 }) as Promise<...>`。
- 本物の契約は `src/background/messageTypes.ts:92-105` — `{title,url,content,force?,skipAi?} & ByteStatsPayload`、maskedCount? は SAVE_RECORD のみ。
- 現状の validator は required field のみ検査するため実害は未顕在化である。`validators.ts` が unknown-key 厳格化（defense-in-depth 方針）を採ると runtime 破綻する。
- `src/messaging/messageTransport.ts` の send シグネチャ拡張が必要なら、既存ジェネリクスと整合させること。
- `ByteStatsPayload` の op 間での必須 / 任意差（maskedCount? が SAVE_RECORD のみ等）を型で表現する必要がある。
- previewFlow の既存テストは `Record<string, unknown>` を前提にしている可能性があり、型更新が必要。
- マスターパスワード re-encrypt PBI（`2026-09-27-fix-master-password-reencrypt-preserve-api-keys.md`、進行中）が settings / storage 系で `messageTypes.ts` を触らないため、競合しない。
- `2026-09-28-14` は `messageTypes.ts` を触るが、そちらは runtime 定数移設のみで型参照は維持される。
- 本 PBI は型のみの変更であり、観測挙動は不変である。型変更に追随するテストのみ追加・更新する。

## 実装者向け注記

### 現状コードの確認

- `src/popup/recordCurrentPage/previewFlow.ts:8-11` に `RecordMessage` 型があり、3 op の payload を `Record<string, unknown>` で手書きしている。
- `buildRecordPayload` は `:59-81` にあり、戻り値型 `Record<string, unknown>`。フィールド集合の記述が 3 度目になっている。
- `pickDefined` 経由で `:79` が maskedCount をどの op にも載せ得る状態である。
- `:85` で `messageTransport.send(message as unknown as ExtensionMessage, { retries: 5 }) as Promise<...>` があり、二重キャストが入っている。
- 本物の契約は `src/background/messageTypes.ts:92-105` の `{title,url,content,force?,skipAi?} & ByteStatsPayload`。maskedCount? は SAVE_RECORD のみ。
- 現状、validator は required field のみ検査するため実害は未顕在化である。
- `src/messaging/messageTransport.ts` に send シグネチャの既存ジェネリクス / オーバーロードがある。
- previewFlow の既存テストは `Record<string, unknown>` を前提にしている可能性がある。
- `2026-09-27-fix-master-password-reencrypt-preserve-api-keys.md`（進行中）は settings / storage 系で `messageTypes.ts` を触らない。
- `2026-09-28-14` は `messageTypes.ts` の runtime 定数移設のみで型参照は維持する。

### 実装手順

1. 3 op（MANUAL_RECORD / PREVIEW_RECORD / SAVE_RECORD）それぞれが送信する type と payload のキー集合・値を baseline として pin するテストを追加する（Red）。
2. previewFlow の既存テストが `Record<string, unknown>` を前提にしている箇所を確認し、型更新の要否を判断する。
3. `src/background/messageTypes.ts:92-105` の契約から op ごとの payload 型を抽出する（`PayloadForType<Op>` 相当の型を型エイリアスとして定義）。
4. `src/popup/recordCurrentPage/previewFlow.ts:8-11` の `RecordMessage` 型を削除する。
5. `messageTransport.send` のシグネチャ（`src/messaging/messageTransport.ts`）が既存ジェネリクス / オーバーロードと整合する形で generic 化、または `Extract<ExtensionMessage, { type: T }>` を受ける形にする。
6. `buildRecordPayload`（`:59-81`）の戻り値を `PayloadForType<Op>` に対して型付けする。
7. `pickDefined`（`:79`）を op の payload キーに制限し、maskedCount がその op に属さない場合に載らないことを型と実行の両方で保証する。
8. `:85` の `as unknown as ExtensionMessage` を解消する。
9. `npm run validate`（type-check + test）が成功することを確認する。実行時ロジック（送信順序・条件・retries: 5）は変更しない。
10. 3 op の parity pin が緑であることを確認する。
11. `validators.ts` の unknown-key 厳格化が将来採用された場合に、popup が送る payload が strict 検証を通過することを type-level テストで確認する。
12. マスターパスワード re-encrypt PBI と `2026-09-28-14` の両方と競合していないことを確認する。

### 落とし穴

- `messageTransport.send` の既存ジェネリクス / オーバーロードとの整合を取らないと、`src/messaging/messageTransport.ts` の他の利用箇所の型推論が壊れる。send 変更前に既存の利用箇所を洗い出す。
- `ByteStatsPayload` の op 間での必須 / 任意差（maskedCount? が SAVE_RECORD のみ等）を無視して「1 つの payload 型」にまとめると、op 間の差分が型で表現されず、本 PBI の目的が失われる。
- `buildRecordPayload`（`:59-81`）は既に 3 度目にフィールド集合を記述しているため、ここを型付けしないと改善にならない。戻り値型と `pickDefined`（`:79`）の両方を確認する。
- `pickDefined` が op の payload キーに制限されていないと、maskedCount がどの op にも載り得る状態が続き、誤搬送の道を残したままになる。
- `:85` の `as unknown as ExtensionMessage` は send のシグネチャを直さないと消せない。send だけ先に直しても payload 型が緩いままだと二重キャストの理由が残る。
- previewFlow の既存テストが `Record<string, unknown>` を前提にしている場合、型を厳密化するとテストが壊れる。型変更前に該当テストを確認する。
- `validators.ts` の unknown-key 厳格化（defense-in-depth）は、本 PBI のような型レベルの整合が前提でないと runtime 破綻につながる。payload 型を緩く保つことで strict 化を回避しない。
- `messageTypes.ts` は `2026-09-28-14`（runtime 定数移設）も触る。型参照（`Extract<ExtensionMessage, { type: T }>`）が runtime 定数移設後も解決できることを確認する。
- マスターパスワード re-encrypt PBI（`2026-09-27`）は settings / storage 系で `messageTypes.ts` を触らないため競合しないが、両方同時に作業する場合でも `previewFlow.ts` と `messageTransport.ts` の担当が重ならないことを確認する。
- 型だけを変更して既存テストの型前提を更新し忘れると、`npm run type-check` が通らない、またはテストが緩い型で通ってしまう。

## 決定事項

1. `RecordMessage`（`previewFlow.ts:8-11`）の手書き型を削除する理由は、payload スキーマが `src/background/messageTypes.ts:92-105` に既に定義されているにもかかわらず、popup 側で `Record<string, unknown>` として 3 度記述されているからである。
2. 契約に無いフィールドが誤搬送できる理由は、`buildRecordPayload`（`:59-81`）の戻り値型が `Record<string, unknown>` であり、`pickDefined`（`:79`）も op の payload キーに制限されていないためである。
3. `buildRecordPayload` の戻り値を `PayloadForType<Op>` に対して型付けし、`pickDefined` を op の payload キーに制限する。
4. `messageTransport.send` を generic 化し（`send<T extends 'MANUAL_RECORD'|'PREVIEW_RECORD'|'SAVE_RECORD'>(m: Extract<ExtensionMessage, { type: T }>)`）、`src/messaging/messageTransport.ts` の既存ジェネリクス・オーバーロードと整合させる。
5. `previewFlow.ts:85` の `as unknown as ExtensionMessage` を解消する。
6. `ByteStatsPayload`（`messageTypes.ts:92-105`）の op 間での必須 / 任意差（maskedCount? が SAVE_RECORD のみ等）を型で表現する。
7. 本 PBI は型のみの変更であり、観測挙動（送信 type・payload のキー集合と値・retries: 5）は変更しない。維持は parity テストで pin する。
8. `validators.ts` が unknown-key 厳格化（defense-in-depth 方針）を採用する場合に runtime 破綻しないことを type-level テストで確認する。現状の required field のみ検査のもとでは実害は未顕在化である。
9. マスターパスワード re-encrypt PBI（`2026-09-27`、進行中）は settings / storage 系で `messageTypes.ts` を触らないため競合しない。`2026-09-28-14` は runtime 定数移設のみで型参照は維持されるため、整合を保って並列実装できる。

## Definition of Done

- [ ] `src/popup/recordCurrentPage/previewFlow.ts:8-11` の `RecordMessage` 型が削除され、契約を `src/background/messageTypes.ts:92-105` から抽出した型が payload スキーマの SSOT になっている。
- [ ] `buildRecordPayload`（`:59-81`）の戻り値型が `PayloadForType<Op>` に対して型付けされ、`pickDefined`（`:79`）が op の payload キーに制限されている。
- [ ] `messageTransport.send`（`:85`）の `as unknown as ExtensionMessage` が解消され、`src/messaging/messageTransport.ts` の send シグネチャが既存ジェネリクス / オーバーロードと整合し、他の利用箇所の型推論が壊れていない。
- [ ] `ByteStatsPayload`（`messageTypes.ts:92-105`）の op 間必須 / 任意差が型で表現され、未知の message type がコンパイル時に拒否されることを確認している。
- [ ] 既存テストのうち `Record<string, unknown>` を前提にしている箇所の pin 更新が必要か確認し、反映している。
- [ ] 3 op それぞれについて送信 type と payload のキー集合・値が refactor 前 baseline と一致する（parity pin）ことを示し、`retries: 5`（`previewFlow.ts:85`）が維持されている。
- [ ] `validators.ts` の unknown-key 厳格化を受容でき、popup が送る payload が strict 検証を通過することが type-level で確認されている。
- [ ] `2026-09-28-14`（messageTypes.ts の runtime 定数移設）との型参照の整合を保ち、マスターパスワード re-encrypt PBI（`2026-09-27`）と競合していない。
- [ ] refactor 前後の観測挙動（送信 type・payload のキー集合と値・retries）が不変であることを parity テストで示している。byte-identical でなくても観測挙動不変でよい。
- [ ] `npm run validate` が成功し、既存動作に回帰がなく、コードレビューが完了している。
