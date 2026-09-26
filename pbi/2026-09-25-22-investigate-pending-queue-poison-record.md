# PBI: pendingSqliteQueue の毒レコード隔離

種別は `investigate` とする。failure taxonomy を確定し、record 単位の分離方式を裁定した後、実装を `fix` に昇格する。

## ユーザーストーリー

ユーザーとして、pending キュー内の不正な履歴が 1 件あっても、同じ 50 件チャンクの健全な履歴 49 件まで一緒に捨てられないようにしたい。1 件の不正レコードが継続的な失敗 lifecycle を生まず、明示的な batch failure、throw、件数不一致を区別した record 単位の分離方式が決められていると信頼できる。

## ビジネス価値

- 1 件の不正データによって健全な履歴 49 件を失うことを防ぐ。
- 健全なレコードと不正なレコードが同じ `retryCount` を共有し、5 回で drop される問題を解消する。
- transient outage に対する再帰分割を禁止し、message 数の肥大化を防ぐ。
- failure taxonomy と retry 資格を明確にし、同一事象を worker、backend、wire decoder、Service Worker で異なる意味に解釈する余地を減らす。

## 優先度

- 順位: 22 / 30
- RICEスコア: 0.75（Reach=3 / Impact=1 / Confidence=50% / Effort=2 SP）

## BDD受け入れシナリオ

本 PBI は調査であり、以下は分離方式を裁定して `fix` に昇格するための受け入れ条件である。

```gherkin
Scenario: 決定的な不正レコードを健全な履歴から分離する
  Given pending キューに 50 件の履歴があり、1 件だけが決定的に不正である
  When 次の flush がそのチャンクを処理する
  Then 健全な 49 件が不正レコードと同じ retryCount と drop lifecycle を共有しない
  And 健全な 49 件が再試行と退避の対象から分離される
  And 不正レコードを特定できないままチャンク全体を破棄しない

Scenario: transient outage ではチャンクを分割しない
  Given pending キューに 50 件の履歴がある
  And insertBatch が retriable error を返す
  When flush がそのチャンクを処理する
  Then 50 件全体が次回の flush に残る
  And 決定的な失敗向けの再帰二分探索を実行しない
  And transient outage 1 回が多数の message に膨らまない

Scenario: duplicate を成功として完了する
  Given pending キューに含まれる 50 件がすべて既に保存済みである
  And insertBatch が success:true と inserted=0、skipped=50 の結果を返す
  When flush がそのチャンクを処理する
  Then 50 件を failure として扱わずチャンクを完了する
  And duplicate を理由に再試行しない

Scenario: success:true でも件数不一致を黙って成功扱いしない
  Given pending キューに 50 件の履歴がある
  And insertBatch が success:true を返すが inserted + skipped が chunk.length 未満である
  When flush がその response を処理する
  Then 件数不一致を黙って成功扱いしない
  And response に記録されていない record を無言で queue から削除しない
```

## 受け入れ基準

- [ ] failure taxonomy が、決定的な record failure、retriable batch failure、件数不一致または response contract failure、通常の duplicate skip を区別する。
- [ ] 1 poison + 49 healthy の混合チャンクについて、健全な 49 件が poison record と retry lifecycle を共有しないことを検証する受け入れ条件が定義されている。
- [ ] 方式として、決定的な失敗に限定した再帰二分探索と、response 契約へ失敗 record の index を追加する方式を比較している。
- [ ] retriable error では再帰二分探索を行わず、chunk 全体を次回 flush に残す。
- [ ] duplicate insert は正常な `skipped` であり、failure にも再試行対象にもしない。
- [ ] `success:true` かつ `inserted + skipped < chunk.length` の response を、根拠なく chunk 全体の成功として扱わない。
- [ ] 既存の明示的な batch failure で failed chunk だけを `remaining` に戻して後続 chunk を継続する動作を維持する。
- [ ] throw 時に flush 全体が止まる現行動作と、records が `chrome.storage.local` に残る挙動を維持する。
- [ ] 裁定結果と検証可能な後続 `fix` の受け入れ条件が PBI に記録されている。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 1 poison + 49 healthy の混合チャンクを production の flush 経路へ通し、健全な 49 件が poison record と共に drop されないことを最小構成で確認する。
- enqueue、startup flush、periodic flush の 3 call site が同じ record isolation 契約を使うことを確認する。

### 統合テスト

- `src/background/__tests__/pendingSqliteQueue.test.ts` に、1 poison + N healthy の混合 chunk シナリオを追加する。
- `success:true` かつ `inserted + skipped < chunk.length` の response シナリオを追加する。
- 決定的な失敗だけが再帰二分探索へ入り、retriable error は chunk 全体を保持するシナリオを追加する。
- duplicate がすべて `skipped` として扱われ、再試行されないシナリオを追加する。
- 明示的な batch failure、throw retention、shared `retryCount`、5 回 drop の既存期待値を維持する。
- response 契約へ failure index を追加する方式を採用する場合は、Offscreen Worker、全 backend、wire decoder、Service Worker の契約を同時更新するテストを追加する。
- `src/offscreen/__tests__/insertBatch-counting-parametric.test.ts` に、row error が `skipped` に加算されず、transaction error が成功 response になり得る現状の失敗経路を固定する。

### 単体テスト

- failure kind ごとの retry 資格と、record 分離の適用条件を検証する。
- 決定的な失敗時だけ再帰二分探索へ入り、retriable error と正常な duplicate へ入らないことを検証する。
- `inserted`、`skipped`、未応答 record の照合が健全な record を誤って再試行させないことを検証する。
- retry state が `chrome.storage.local` に保存され、module-local state を耐久化先として使わないことを検証する。

## 実装アプローチ

- Outside-In で、1 poison + N healthy の混合 chunk と `success:true` かつ件数不一致の失敗テストを先に固定する。
- `pbi/2026-09-25-11-refactor-structured-failure-taxonomy.md` の failure kind と retry 資格を共有し、record failure と batch outage を区別する。
- `pbi/2026-09-25-01-fix-transport-replay-safety.md` と `insertBatch` の再実行可能性の判定を共有する。
- 決定的な record failure に限定した再帰二分探索と、response 契約への failure index 追加を、retry 安全性、message 数、改修範囲の観点から比較する。
- retriable error、duplicate skip、明示的な batch failure、throw、件数不一致の既存契約を維持できる方式を裁定する。
- 裁定結果を後続 `fix` の実装手順と受け入れ基準へ移し、response 方式を採用する場合は全層を同時更新する。

## 見積もり

2 SP

## 技術的考慮事項

- `src/background/pendingSqliteQueue.ts:18-21` のキュー上限は 5,000 件、`:35-36` の chunk サイズは 50 件である。
- 1 回の失敗では最大 50 件が同じ retry lifecycle を共有する。
- `src/background/pendingSqliteQueue.ts:80-88` は明示的な `{ success:false }` で failed chunk だけを `remaining` に戻し、後続 chunk へ進む。
- `src/background/pendingSqliteQueue.ts:84-97` の throw は catch されず flush 全体を止めるが、records は storage に残る。
- `src/background/pendingSqliteQueue.ts:80-83` は `success:true` でも `inserted + skipped < chunk.length` を確認せず chunk 全体を捨てる。
- `src/offscreen/opfsWorker/crudHandlers.ts:121-140` は row error を catch 後も `skipped` に加算せず、transaction error も成功結果を返し得る。
- production call site は enqueue の `src/background/pipeline/steps/saveSqliteStep.ts:86-92`、startup flush の `src/background/handlers/lifecycleHandlers.ts:96-100`、periodic flush の `src/background/alarmRegistry.ts:79-83` の 3 か所である。
- transient outage で全 chunk を再帰分割すると、1 outage が最大 100 件以上の message に膨らむため、`retriable` error では分割しない。
- response 契約で record 単位の failure を返す場合、Offscreen Worker、全 backend、wire decoder、Service Worker の同時更新が必要である。
- retry state は必ず `chrome.storage.local` に保存し、module-local state へ耐久化しない。
- `src/background/offlineNetworkQueue.ts:25-33` の既存上限である 50KB、200 件、TTL 7 日、1 cycle 20 件を維持する。
- 依存関係は `pbi/2026-09-25-01-fix-transport-replay-safety.md` と `pbi/2026-09-25-11-refactor-structured-failure-taxonomy.md` である。

## 実装者向け注記

### 現状コードの確認

- `src/background/pendingSqliteQueue.ts` の明示的 failure、throw retention、成功 response の件数照合を確認する。
- `src/offscreen/opfsWorker/crudHandlers.ts:121-140` における row error と transaction error の response 生成を確認する。
- 3 つの production call site が同じ pending queue flush 契約を使うことを確認する。
- `src/background/__tests__/pendingSqliteQueue.test.ts` の 50 件 chunking、failed chunk だけ pending で後続 chunk 継続、throw retention、shared `retryCount` の増加と 5 回 drop を確認する。
- `src/background/pipeline/steps/__tests__/saveSqliteStepDoubleFailure.test.ts`、`src/background/handlers/__tests__/lifecycleHandlers-pendingQueue.test.ts`、`src/offscreen/__tests__/insertBatch-counting-parametric.test.ts` を確認する。
- 1 poison + N healthy の混合 chunk テストと、`success:true` かつ件数不一致のテストが存在しないことを確認する。

### 実装手順

1. 依存する 2 PBI から failure kind、retry 資格、`insertBatch` の再実行可能性を共有する。
2. 決定的な record failure、retriable batch failure、件数不一致または contract failure、duplicate skip の判定表を確定する。
3. 決定的な失敗に限定した再帰二分探索と、response 契約への failure index 追加を比較する。
4. retriable error を chunk 全体の retention に固定し、正常な duplicate が分割や再試行の対象にならないことを明記する。
5. 採用方式を 1 つに裁定し、必要なら全 backend と wire 契約の変更範囲を確定する。
6. 1 poison + N healthy、件数不一致、transient outage、duplicate の受け入れテストを後続 `fix` へ引き継ぐ。
7. shared `retryCount` の既存期待値を、新しい record isolation 契約に合わせて更新する。

### 落とし穴

- 部分的な chunk 失敗で `inserted + skipped` の数合わせを誤ると、健全な record を再試行し続ける。
- duplicate を failure と扱って再試行すると、成功済み record に不要な retry lifecycle を作る。
- retriable outage まで再帰分割すると、message 数と retry lifecycle を不必要に拡大する。
- response の failure index を追加する場合に Offscreen Worker、backend、wire decoder、Service Worker のいずれかを更新し忘れると、record isolation の判定が層間で不一致になる。
- row error を `skipped` に加算しないまま成功 response に戻すと、poison record が無言で queue から消える。
- retry state を module-local に置くと、Service Worker 再起動時に lifecycle を復元できない。
- `src/background/__tests__/pendingSqliteQueue.test.ts` の shared `retryCount` の期待値を、record 単位の分離を反映しないまま維持すると誤った挙動を固定する。

## 決定事項

1. なぜ poison が仲間を巻き込むか: キューの成否判定が 50 件単位だから。
2. なぜ batch 単位か: `insertBatch` の response が 1 個の成否と count しか持たないから。
3. なぜ失敗 row を識別しないか: worker と backend が row error を成功 response に畳み込むから。
4. なぜ batch response だけか: batching は transport と performance 用のため、durable queue の record 単位 delivery semantics が未設計だったから。
5. なぜテストが気づかなかったか: duplicate と failure が同じ成功 response に紛れていて poison scenario が無いから。

裁定規則は次のとおりとする。

- 決定的な record failure だけが再帰二分探索の対象になる。
- `retriable` batch failure は分割せず、chunk 全体を次回 flush に残す。
- duplicate は正常な `skipped` であり、failure ではない。
- response で record 単位の failure を表現する方式を選ぶ場合は、Offscreen Worker、全 backend、wire decoder、Service Worker を同時に更新する。
- 最終方式は、failure taxonomy、retry 安全性、message 数、既存 retry state の制約を基に裁定する。

## Definition of Done

- [ ] failure taxonomy が決定的な record failure、retriable batch failure、response contract failure、duplicate skip を区別している。
- [ ] 再帰二分探索と failure index を持つ response 契約を、retry 安全性、message 数、改修範囲の観点で比較している。
- [ ] record 単位の分離方式を 1 つに裁定し、retriable error を分割しない条件を記録している。
- [ ] 1 poison + N healthy の混合 chunk と `success:true` かつ件数不一致の受け入れ条件が後続 `fix` に引き継がれている。
- [ ] response 方式の採用有無と、Offscreen Worker、全 backend、wire decoder、Service Worker の同時更新要否が確定している。
- [ ] retry state を `chrome.storage.local` に保持し、50KB、200 件、TTL 7 日、1 cycle 20 件の既存上限を維持する方針が後続 `fix` に引き継がれている。
- [ ] 本調査では本番コードを変更せず、裁定結果と必要な受け入れ条件を `fix` PBI に移している。
