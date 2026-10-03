# PBI: ソース正規表現ピンを実行時ピンへ寄せ、固定 drain を完了シグナルに置換

## ユーザーストーリー

テストの保守担当者として、wireOnce（二重リスナー防止）の回帰ピンが実装の書き方（変数名・関数抽出・optional chain の有無）にではなく実行時挙動（2x init + 1 click => 1 write）に固定されていることを期待する。また、負の断言のための固定 drain（setTimeout(0) の回数）が「drain より後で着地する重複」を見逃さないことを期待する。

## 優先度

- 順位: 13 / 15
- RICE: 0.9（R=1 / I=1 / C=0.9 / Effort=1.0）
- 根拠: 直接收束先はテスト保守のみ（Reach 1）だが、ソース正規表現ピンはリネーム・抽出で偽陽性を、固定 drain の回数固定は非対称な重複で偽陰性を生むテスト信頼性の問題。実行時 twin の実在を含めコード確認済み（C=0.9）。

## 背景（file:line 付き現状）

(a) ソース正規表現ピン（statusPanel）

- `src/popup/__tests__/statusPanel-wireOnce-parity.test.ts:184-196` — `readAttachBody()`（`:11-21`、`function attachPrivacyActionListeners` から `\n}\n` までを readFileSync で切り出し）に対し `/wireOnce\(\s*addDomainBtn/` と否定 `/addDomainBtn\?\.\s*addEventListener/` のソース正規表現でピンしている。
- 変数リネーム・`attachPrivacyActionListeners` からの抽出・非 optional chain 形（`addDomainBtn.addEventListener`）への書き換えで落ちる。否定正規表現は optional chain 形しか見ない。
- 同一ファイルに実行時 twin が実在: `:198-229` — 「2x init + 1 click => exactly 1 write」で mockSetAll の呼び出し回数を直接断言。tripwire コメント（`:2-4`、`:99`、`:208-210`）も意図を説明している。

(b) ソース正規表現ピン（popup main）

- `src/popup/__tests__/main-domcontentloaded.test.ts:133-135` — `mainSource` に `/chrome\.tabs\.query/` が含まれないことを断言する逸脱検出ピン。tripwire コメント `:64-66` が意図を説明。実行時 twin `:167-177`（seam 経由の読み取り + `chrome.tabs.query` 未呼出断言）が同居しており、実行時ピンで同等の回帰信号が既に得られている。

(c) 固定 drain の非対称性

- `src/popup/__tests__/statusPanel-wireOnce-parity.test.ts:207-213` — `waitForMock` 後に `drainMacrotask()` ×2（`testDir/waitPolicy.ts:38-40`、`setTimeout(resolve, 0)` の yield 1 回/呼出）してから `toHaveBeenCalledTimes(1)`。
- `src/background/__tests__/alarmRegistry.test.ts:68-72` — `settle()` が `setTimeout(0)` ×20。回数が根拠なく 2 と 20 に割れており、drain より多くの macrotask hop（>2-hop）を経る重複リスナーは drain 後に着地し、バグがあるまま green になり得る。

## BDD受け入れシナリオ

### Scenario 1: wireOnce の回帰ピンは実行時挙動で固定される

```gherkin
Given statusPanel の statusAddDomain/statusAddPath の二重リスナー防止を回帰ピンしたい
When attachPrivacyActionListeners の実装を変数リネームや関数抽出で書き換える（wireOnce 経由を維持）
Then ソース正規表現の一致不一致でテストが落ちない
And 2x init + 1 click => 1 write の実行時断言が回帰を捕捉する
```

### Scenario 2: 負の断言は drain 回数に依存しない

```gherkin
Given 重複リスナーが N hop（N > 2）の macrotask で resolve され得る
When 2x init + 1 click の負の断言（write が 1 回）を実行する
Then 固定回数の drainMacrotask/settle ではなく決定的な完了シグナルで重複の着地を待つ
And 重複が実在する場合にテストが赤になる
```

### Scenario 3: 意図的な tripwire は文書化して残す

```gherkin
Given main-domcontentloaded.test.ts のソース逸脱ピンには実行時 twin が同居している
When ピンの意図（tripwire として意図的に残す）を判断する必要が生じる
Then tripwire と判断したピンには理由が文書化されている
And 実行時 twin で同等の回帰信号が担保されている
```

## 受け入れ基準

- [x] 1. `statusPanel-wireOnce-parity.test.ts:184-196` のソース正規表現ピンを実行時 twin（`:198-229`）で置換または抑制する。リネーム・抽出・非 optional chain 形で落ちない形にする。
- [x] 2. `statusPanel-wireOnce-parity.test.ts:207-213` の `drainMacrotask()` ×2 を、重複リスナーの完了を決定的に待つ方式（完了シグナル、mock 呼び出しの安定待ち等）に置換し、>2-hop の重複でも偽陰性にならないことを検証する。
- [x] 3. `alarmRegistry.test.ts:68-72` の `settle()`（×20）を、駆動対象の完了条件に基づく待ちへ置換するか、回数の根拠と限界をコメントで明示する。
- [x] 4. `main-domcontentloaded.test.ts:133-135` の逸脱ピンは tripwire として保持する場合、`:64-66` のコメントに実行時 twin（`:167-177`）との役割分担を明記する。
- [x] 5. 対象は上記 2 テストファイルと `testDir/waitPolicy.ts`（必要な場合のみ）に限定し、production コードは変更しない。

## テスト戦略

- リファクタ耐性検証: 変数リネーム・関数抽出をシミュレートし、置換後のピンがソースの書き方に依存しないことを確認。
- 偽陰性検証: 重複リスナーを意図的に注入し、置換後の負の断言が赤になることを確認。
- 既存 twin（`statusPanel-wireOnce-parity.test.ts:198-229`、`main-domcontentloaded.test.ts:167-177`）が green を維持。
- `npx vitest run <files> --repeats=20` で全 run green。

## 見積もり

3 SP（Effort 1.0）

## Definition of Done

- [x] BDD 3 シナリオが検証され green
- [x] ソース正規表現ピンの置換または文書化が完了している
- [x] 固定 drain の置換または根拠明示が完了している
- [x] リファクタ耐性・偽陰性検証の結果が報告に含まれる
- [x] `npm run validate` が green
- [x] backlog（順位 13）としての完了報告が紐づく — アーカイブ/台帳更新は別ステップ

## 実装記録（2026-10-03）

- 1. `statusPanel-wireOnce-parity.test.ts` — ソース正規表現ピン（`readAttachBody()` + `/wireOnce\(\s*addDomainBtn/`）を削除し、EventTarget seam での attach 観測（`observeClickAttaches()`）に置換。2x init 後に可視ボタンへ正確に 1 click listener が attach されていることを断言 — 変数リネーム・関数抽出・optional chain 形式に依存しない
- 2. 同ファイルの `drainMacrotask()` ×2 を廃止 — 重複ハンドラは attach レベル（2 attach 目）として観測されるため、macrotask hop 数に依存しない負の断言になり、>2-hop の重複も偽陰性にならない
- 3. `alarmRegistry.test.ts` — `settle()`（×20）を削除し、`waitForMock` による正確な期待値待ちへ置換（8 箇所）。負のテスト（unknown name / session-timeout non-dispatch）には正の anchor（既知 alarm の dispatch 完了待ち）+ 1 drain を付与（waitPolicy の sanctioned negative 形）
- 4. `main-domcontentloaded.test.ts` — 逸脱ピン（`/chrome\.tabs\.query/` 不在断言）は tripwire として保持し、chrome stub のコメントに runtime twin との役割分担（twin は実行経路、pin は twin が実行しない将来経路の直接呼出を捕捉）を明記
- 5. 対象限定を遵守 — `testDir/waitPolicy.ts` 無変更、production コード無変更（`alarmRegistry.ts` / `service-worker.ts` の差分は PBI 15 のコメントのみ）
- 逸脱: spy の `mockImplementation` 型注釈に `| null` を追加 — testDir 型ベースラインが 489→490 に増加したため修正し 489 に復帰（validate ゲート対応）
- 検証: tsc 0 エラー・test 15,476 pass・validate exit 0・当該 24 tests green・repeats=20
