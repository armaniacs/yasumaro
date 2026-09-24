# PBI: Obsidian 書込 replay の冪等性方式の確定

種別: investigate（外部 API 契約と owner 確定が前提 → 実装は `fix` に分割）

## ユーザーストーリー

一時的な障害で自動再試行が重なっても Obsidian ノートが二重に汚れないユーザーとして、offline `obsidian_sync` の replay を冪等にする方式がほしい。同一 body の PUT と「GET、section insert、full-note PUT」の全体 replay を区別し、外部 API 契約、operation ID、marker、dedupe window、409 扱いを裁定したうえで、後続実装に利用できる仕様を確定したい。

## ビジネス価値

- offline `obsidian_sync` の再処理で同じ section が Obsidian ノートへ重複して積み上がることを防ぐ。
- 同一 body の PUT 再送と read-modify-write 全体の replay を別の retry として扱う境界を定める。
- 外部 API 契約と retry owner を確定し、後続 `fix` が推測なく実装できる受け入れ基準へ変換する。
- dashboard のユーザー明示操作と、自動再試行で要求される冪等性の強度を区別する。

## 優先度

順位: 13 / 30
RICEスコア: 2.0（Reach=2 / Impact=2 / Confidence=50% / Effort=1 SP）— 依存（12 完了後）で降格

## BDD受け入れシナリオ

```gherkin
Feature: Obsidian 書込 replay の冪等性方式の確定

  Scenario: 自動 replay の重複を防ぐ裁定
    Given 同一 body の PUT 再送は冪等である
    And GET、section insert、full-note PUT の全体 replay は冪等ではない
    And offline replay は Markdown と現在時刻を再生成し、section editor は同一内容を検出せず再挿入する
    When 5 Whys を通じて write retry の設計を調査する
    Then 生成時刻を固定する時点を裁定する
    And operation ID、marker、dedupe window の採否と組み合わせを裁定する
    And 裁定結果を後続 fix の受け入れ基準とテストへ変換する

  Scenario: Local REST API 契約の確定
    Given 現行の HTTP surface は GET 2 回と PUT 1 回だけである
    And PATCH、POST、DELETE は実装されていない
    And dev-docs/API_ENDPOINTS.md も GET、GET、PUT を対象にする
    When 上流の一次情報から idempotency header と 409 の提供状況を確認する
    Then 対応可否と根拠となった一次情報を記録する
    And 外部 API 契約の確定先と owner を記録する
    And 未対応または確認できない場合は本文 marker の採否と制約を裁定する

  Scenario: retry owner と stable operation ID の裁定
    Given offlineQueueProcessor は job.id を捨て、retry trace は毎回新規生成される
    And offline retry queue と Obsidian-only retry path が存在する
    When recovery route の owner 裁定と failure SSOT を確認する
    Then どちらの retry path が自動再試行の owner かを記録する
    And stable operation ID が必要かどうかに裁定する
    And 必要な場合は offline job payload または local storage に保存し、Service Worker memory に依存しない
    And 必要な場合は同じ replay が同じ operation ID を再利用する

  Scenario: ユーザー明示操作と自動 retry を区別する
    Given dashboard append はユーザーが明示的に実行する操作である
    And offline obsidian_sync は自動 retry である
    When 2つの write call site の冪等性要件を比較する
    Then dashboard append と自動 retry で同じ冪等性要件を強制するか裁定する
    And 別々の要件とする場合はそれぞれの境界と例外を記録する
    And どちらの call site にも同じ retry 処理を適用しない

  Scenario: 後続 fix へ制約を引き継ぐ
    Given 非 loopback host の平文 HTTP は拒否されている
    And HTTPS が既定である
    When 裁定した方式を後続 fix の仕様に変換する
    Then HTTPS、API key の送信元と log 露出禁止を維持する
    And GET、GET、PUT の HTTP surface を維持する
    And ESM import は .js 拡張子を使い、async/await のみを使う
```

## 受け入れ基準

- [ ] `pbi/2026-09-25-12-fix-offline-recovery-single-owner.md` の裁定により、offline retry queue と Obsidian-only retry path の owner が記録されている。
- [ ] `pbi/2026-09-25-11-refactor-structured-failure-taxonomy.md` の failure SSOT と retry 述語を共有できるか、または分離するかが記録されている。
- [ ] 5 Whys の全問に、調査で与えられた事実、判断材料、裁定、残存リスクが対応づけられている。
- [ ] `formatMarkdownStep` が retry ごとに生成時刻を作り直す現状と、生成時刻を固定する時点が記録されている。
- [ ] `NoteSectionEditor` が同一内容を検出せず無条件に再挿入する現状が記録されている。
- [ ] `traceId` が本文、header、idempotency key ではないこと、`offlineQueueProcessor` が `job.id` を捨てていることが裁定に含まれている。
- [ ] operation ID を採用する場合は、生成者、owner、保存先、再利用条件、保存期間が offline job payload または local storage で定義されている。
- [ ] operation ID を採用しない場合も、marker、dedupe window、409 扱いを採用しない理由と代替方式が記録されている。
- [ ] Local REST API plugin の idempotency header と 409 の提供状況が、一次情報と確定先とともに記録されている。
- [ ] 本文 marker を採用する場合は、dedupe window の長さ、判定位置、既存 note section との境界が定義されている。
- [ ] dedupe window の長さとして 24 時間などを採用する場合は、値と固定する場所が明記されている。
- [ ] 同一 body の PUT 再送と、GET、section insert、full-note PUT の全体 replay が別の retry として扱われている。
- [ ] dashboard append はユーザー明示操作として、自動 retry とは異なる冪等性要件の採否が記録されている。
- [ ] `saveToObsidianStep` と dashboard append の2つの production write call site の適用範囲が記録されている。
- [ ] GET 2 回、PUT 1 回以外の HTTP surface を追加しない。
- [ ] 非 loopback host の平文 HTTP を拒否し、HTTPS を既定にする。
- [ ] API key は Authorization header 以外、operation ID、log に出さない。
- [ ] Service Worker memory を stable operation ID の保存先として使わない。
- [ ] `dev-docs/API_ENDPOINTS.md` の GET、GET、PUT 記載との整合を後続 `fix` の変更範囲に含めている。
- [ ] すべての ESM import は `.js` 拡張子を使い、async/await のみを使う。
- [ ] 既存の `noteSectionEditor.test.ts` が常に挿入する現行挙動を pin している事実を、テスト変更の注意書きに含めている。
- [ ] 既存重複を移行で除去する手段を本 PBI の範囲外として明記している。
- [ ] 本 PBI は調査と方式設計に限定し、実装は別の `fix` PBI に分離している。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 本 PBI は調査と方式設計に限定するため、E2E テストは実行しない。
- 後続 `fix` では、offline `obsidian_sync` の初回処理後に一時障害が発生し、再処理しても同じ section が1件だけ残る Outside-In シナリオを定義する。
- 後続 `fix` では、AI を再実行しない既存 offline retry の契約を冪等性確認の前提として維持する。
- 後続 `fix` では、dashboard の明示操作と自動 retry の要件を別々に確認する。
- 後続 `fix` では、成功応答、network failure、Obsidian-only retry 後の結果を外部 API 契約に沿って確認する。

### 統合テスト

- `src/background/__tests__/offlineQueueProcessor.test.ts` を利用し、`obsidian_sync` が AI を再実行しない既存契約を replay 冪等性の前提として整理する。
- `src/background/__tests__/recordingPipeline-full.test.ts:247-292` を利用し、offline queue と Obsidian-only retry path の replay 境界を確認する。
- `src/background/noteSectionEditor.test.ts` の「常に挿入する」現行 pin を、採用した marker または dedupe 方式の期待値へ変更する後続 `fix` の影響対象にする。
- `src/background/obsidianClient.ts:121-153` の mutex 済み read-modify-write に対して、同じ operation が replay されても1件だけ残ることを確認する後続 `fix` の統合契約を定義する。
- operation ID、idempotency header、409 を採用する場合は、Obsidian API の stub における request header、status、request 回数を確認する。
- marker または dedupe window を採用する場合は、GET、section insert、full-note PUT の各段階で同じ replay を再現する。
- `pbi/2026-09-25-11-refactor-structured-failure-taxonomy.md` の failure SSOT を参照する場合、retry 述語と重複定義を作らないことを確認する。
- `pbi/2026-09-25-04-fix-obsidian-get-retry.md` の GET retry が本 PBI の write replay 裁定へ影響しないことを確認する。

### 単体テスト

- 同じ offline job payload から同じ stable operation ID が得られるか、採用する場合に確認する。
- 異なる replay で時刻が再生成される現行挙動と、生成時刻を固定する方式を後続 `fix` の単体テスト対象にする。
- 採用する場合、marker の一致、不一致、欠落を裁定どおり判定する。
- 採用する場合、dedupe window の直前、境界、経過後を裁定した長さで判定する。
- 採用する場合、409 の retryable、terminal、idempotent success の扱いを裁定どおり分類する。
- 同一 body の PUT と全体 replay が別の retry として扱われることを後続 `fix` の単体契約にする。
- dashboard append が採用する要件を、自動 retry の要件と混同せず判定する。
- API key が operation ID や log、例外へ含まれないことを確認する。

## 実装アプローチ

1. 依存する `pbi/2026-09-25-12-fix-offline-recovery-single-owner.md` の owner 裁定を確認する。裁定が未確定なら、本 PBI の最終方式確定を完了扱いにしない。
2. `pbi/2026-09-25-11-refactor-structured-failure-taxonomy.md` の failure SSOT と retry 述語の利用可否を確認する。
3. `appendToDailyNote`、offline `obsidian_sync` の replay、Obsidian-only retry、2つの production write call site、既存テストを調査台帳に整理する。
4. 5 Whys を順に実施し、時刻再生成、`job.id` 破棄、retry trace 再生成、section editor が同一内容を検出しないという確認済みの事実を判断材料にする。
5. Local REST API plugin の上流の一次情報から idempotency header と 409 の提供状況を確認する。根拠となる情報と契約 owner がない状態では、未確認として裁定する。
6. operation ID、idempotency header、本文 marker、dedupe window、409 扱いを、read-modify-write 全体の replay に対して比較する。
7. stable operation ID が必要かを裁定する。採用する場合は、生成時刻の固定、生成者、owner、offline job payload または local storage への保存、再利用条件を定義する。
8. dedupe window を採用する場合は、長さと判定位置を固定する。24 時間などの具体値は、調査結果と判断根拠に基づいて裁定する。
9. dashboard append と自動 retry の冪等性要件を分離するか裁定し、採用した境界を production call site ごとに記録する。
10. 裁定結果を、後続 `fix` の変更対象、BDD シナリオ、E2E、統合、単体テスト、既存テストの期待値変更へ変換する。
11. 本 PBI ではプロダクションコード、既存テスト、`dev-docs/API_ENDPOINTS.md` を変更せず、裁定と実装範囲のみを本 PBI に記録する。

## 見積もり

1 SP（調査・方式設計まで。実装は別 PBI になる想定）

## 技術的考慮事項

- 同一 body の PUT 再送は冪等である。一方、GET、section insert、full-note PUT の全体 replay は冪等ではない。
- `appendToDailyNote` の mutex は read-modify-write の競合を直すが、replay 間の同一 operation の識別までは保証しない。
- offline `obsidian_sync` の replay では `formatMarkdownStep` が Markdown と現在時刻を再生成する。
- `NoteSectionEditor` は同一内容を検出せず無条件に再挿入するため、時刻を含む Markdown の replay でも section が重複する。
- `traceId` は helper と log に渡されるだけで、本文、header、idempotency key にはならない。
- `offlineQueueProcessor` は `job.id` を捨てるため、既存実装のままでは job ID を stable operation ID として使えない。
- stable operation ID を採用する場合は、Service Worker memory ではなく offline job payload または local storage に保存する。
- `saveToObsidianStep` と dashboard append の2つの production write call site があり、dashboard append はユーザー明示操作である。
- offline retry queue と Obsidian-only retry path は実装済みであり、owner を二重化させない。
- HTTP surface は GET 2 回、PUT 1 回であり、PATCH、POST、DELETE を追加しない。対象は `dev-docs/API_ENDPOINTS.md` の記載に合わせる。
- Local REST API plugin の idempotency header と 409 の提供状況は未確定であり、上流の一次情報で確認する。
- API key は Authorization header 以外、operation ID、log に出さない。
- 非 loopback host の平文 HTTP は `src/utils/obsidianConfigValidator.ts:35-66` で拒否済みであり、HTTPS 既定を維持する。
- `noteSectionEditor.test.ts` は「常に挿入する」現行挙動を pin しているため、採用方式に応じて期待値を変更する必要がある。
- 既存重複を移行で除去する手段は本 PBI の範囲外である。
- すべての ESM import は `.js` 拡張子を使い、async/await のみを使う。
- `pbi/2026-09-25-04-fix-obsidian-get-retry.md` は独立で先行済みであり、GET retry と write replay の retry を同一視しない。

## 実装者向け注記

### 現状コードの確認

- `src/background/obsidianClient.ts:121-153` の `appendToDailyNote` は GET、section insert、full-note PUT の read-modify-write であり、mutex を実装済みである。
- `src/background/obsidianClient.ts:159-176`、`:186-207`、`:238-276` から、HTTP surface は GET 2 回、PUT 1 回だけである。PATCH、POST、DELETE は未実装である。
- `src/background/pipeline/formatMarkdownStep.ts:37-51` は offline replay の retry ごとに Markdown を再生成し、現在時刻も変える。
- `src/background/noteSectionEditor.ts:13-30` は同一内容を検出せず無条件に再挿入する。
- `src/background/obsidianClient.ts:129-150` の `traceId` は helper と log に渡されるだけで、本文、header、idempotency key ではない。
- `src/background/offlineQueueProcessor.ts:40-47` は `job.id` を捨てる。
- production の write call site は `src/background/pipeline/steps/saveToObsidianStep.ts:57-71` と `src/background/handlers/dashboardSqlite/deps.ts:237-240` の2つである。
- dashboard append はユーザーが明示的に実行する操作であり、自動 offline replay とは冪等性の要求が異なる。
- offline retry queue と Obsidian-only retry path は `src/background/offlineQueueProcessor.ts:36-60` と `src/background/pipeline/RecordingOrchestrator.ts:151-173` に実装済みである。
- `src/background/noteSectionEditor.test.ts` は常に挿入する現行挙動を pin しており、dedupe test は存在しない。
- `src/background/__tests__/offlineQueueProcessor.test.ts` は `obsidian_sync` が AI を再実行しないことを確認する。
- `src/background/__tests__/recordingPipeline-full.test.ts:247-292` に既存の recording pipeline テストがある。
- `src/utils/obsidianConfigValidator.ts:35-66` は非 loopback host の平文 HTTP を拒否し、HTTPS 既定を維持する。
- `dev-docs/API_ENDPOINTS.md` の対象記載は GET、GET、PUT である。

### 実装手順

1. owner 裁定、failure SSOT、HTTP surface、2つの write call site、既存テストを同じ調査台帳へ整理する。
2. 5 Whys の各問に、確認済みの事実、候補方式、判断材料、残存リスクを記録する。
3. operation ID を必要とする場合としない場合に分け、後者では marker、dedupe window、409 扱いの代替方式を選ぶ。
4. Local REST API plugin の idempotency header と 409 の提供状況について、確認した一次情報と owner を出典付きで記録する。
5. 裁定した方式に対して、時刻の固定場所、operation ID の生成者と保存先、dedupe window の値と判定位置、再利用条件、後続 `fix` の変更範囲を定義する。
6. dashboard append と自動 retry を同一の retry として扱わないようにし、必要なら別 PBI へ分離する。
7. 後続 `fix` で追加または変更する E2E、統合、単体テストと、既存 pin テストの期待値変更を具体化する。
8. 実装とテストを別の `fix` PBI に分割し、`dev-docs/API_ENDPOINTS.md` の HTTP surface を変えない。

### 落とし穴

- 同一 body の PUT 再送が冪等であることを、GET、section insert、full-note PUT の全体 replay にも適用すると誤る。
- `appendToDailyNote` の mutex 実装を、replay の同一性判定と同一視する。
- retry ごとに生成される `traceId` を stable operation ID と誤用する。
- `offlineQueueProcessor` が `job.id` を捨てる現行挙動を確認せず、job ID をそのまま冪等性に使えると決める。
- stable operation ID を Service Worker memory に保存すると、Service Worker 再起動後に失われる。
- Local REST API plugin の idempotency header や 409 の提供を、根拠なしの前提として実装する。
- marker を採用する場合、dedupe window の長さや判定位置を決めないまま retry する。
- dashboard のユーザー明示操作を、自動 retry と同じ要求へ強制する。
- `noteSectionEditor.test.ts` の「常に挿入する」現行 pin を残したまま、dedupe の期待値だけを追加する。
- 既存の重複除去を本 PBI の実装範囲に含めてしまう。
- API key を operation ID や log、例外へ含める。
- `pbi/2026-09-25-04-fix-obsidian-get-retry.md` の安全な GET retry を write replay の retry と共通化する。

## 決定事項

5 Whys を使って次を裁定する。

1. なぜ write 経路の retry 設計が遅れているのか。queue replay が時刻を再生成し、同じ entry を盲目的に再挿入するためである。生成時刻をどの時点・どの保存先で固定するかを裁定する。
2. なぜ job ID をそのまま冪等性に使えないのか。`offlineQueueProcessor` が `job.id` を捨て、retry trace も毎回新規生成するためである。job ID を payload に保持するか、job ID ではなく別の stable operation ID を生成するかを裁定する。
3. Local REST API plugin は idempotency header や 409 をサポートするのか。外部契約の一次情報と owner を確認したうえで、未対応または確認不能な場合は本文 marker で表現するかを裁定する。
4. dedupe window の長さをどこで固定するのか。24 時間など具体的な値と、判定するコンポーネントまたは保存先を裁定する。
5. dashboard append と自動 retry で冪等性の強度を別にしてよいのか。ユーザー明示操作と offline replay の要件を比較し、採用境界を裁定する。

裁定成果物には、5 Whys の根拠、operation ID の採否と保存契約、marker の採否、dedupe window の値と固定場所、409 扱い、retry owner、dashboard との差分、外部 API 契約の一次情報、残存リスク、後続 `fix` の変更対象とテスト範囲を含める。

## Definition of Done

- [ ] `pbi/2026-09-25-12-fix-offline-recovery-single-owner.md` に基づく recovery route owner が確定している。
- [ ] `pbi/2026-09-25-11-refactor-structured-failure-taxonomy.md` の failure SSOT と retry 述語の共有可否が記録されている。
- [ ] 5 Whys の全問に、確認済みの事実、判断材料、裁定、残存リスクが対応づけられている。
- [ ] 同一 body の PUT と GET、section insert、full-note PUT の全体 replay の扱いが区別されている。
- [ ] 生成時刻の固定時点と保存先が裁定されている。
- [ ] operation ID の採否、生成者、owner、保存先、再利用条件が裁定されている。
- [ ] operation ID が不要の場合、marker、dedupe window、409 扱いの代替方式が裁定されている。
- [ ] Local REST API plugin の idempotency header と 409 の提供状況、確認した一次情報、契約 owner が記録されている。
- [ ] dedupe window を採用する場合、長さと固定する場所が明記されている。
- [ ] dashboard append と自動 retry の冪等性要件の採否と境界が明記されている。
- [ ] `saveToObsidianStep` と dashboard append の適用範囲が明記されている。
- [ ] API key が Authorization header 以外、operation ID、log、例外へ含まれない 後続 `fix` の受け入れ基準がある。
- [ ] HTTPS 既定、非 loopback host の平文 HTTP 拒否、GET 2 回、PUT 1 回、ESM `.js`、async/await の制約が後続 `fix` に引き継がれている。
- [ ] 既存 pin テストの変更対象と後続テストの Outside-In 方針が記載されている。
- [ ] 既存重複の除去が本 PBI の範囲外として明記されている。
- [ ] 実装は別の `fix` PBI に分割され、変更対象とテスト範囲が本 PBI 内に特定されている。
- [ ] 本 PBI では対象ファイル以外の変更、テスト実行、git 操作を行っていない。
