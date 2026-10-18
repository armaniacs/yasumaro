# PBI: 日次purgeアラームの24時間カウントダウンがブラウザ利用中にリセットされないようにする

## ユーザーストーリー

>  日常利用者として、**使い続けるだけで定点 Retention 掃除と監査ログの7日スキャンが「発火しないまま滞留」にならないようにしたい**、なぜなら今回は機嫌よく失敗する側（記録を残さない）になるから。

- ロール: 日常利用者（拡張機能を常時オンで使い、中長期で Obsidian ノートを溜め込む人）
- 機能:  日次purgeアラームが「すでに登録済みなら既存の次回発火時刻を尊重し、未登録なら初めて登録する」ガードを持つ
- ビジネス価値:  リテンションpurge（URL記録・エクスポート成果物の30日保持）が確実に発火し、**クラウドAIプロバイダへ送信したURLの監査ログ7日スキャン**も遅延しない。プライバシー記録が「残っているのに消えない／消えないまま増える」ズレを構造的に防ぐ

## 優先度

- 順位: 02 / 25
- RICE: 5600（Reach=400 / Impact=2 / Confidence=100% / Effort=0.2）
- 根拠: 監査2位。`installAll` が SW 起動ごとに `yasumaro-daily-purge` を**無条件再作成**し、5分周期の offline-retry アラームが起動を繰り返すため、日常利用中に24時間purgeのカウントダウンがリセットされ続ける。結果: リtentionpurge（URLやエクスポート成果物の30日保持）が発火せず、監査ログの7日スキャンも遅延する。既存コード（`ensureDailyFlushArmed`）に同種のガードが存在するため修正方針は明白で、機嫌よく失敗する側のソース不変条件が明確。
- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低
- 副作用: 🟡軽微

## 背景（監査の出典）

security-audit run-2（source ref d49d70a3）の needs_validation リード。fingerprint: `a0542fe3849d1e6b087798dfea20534f56ff8035b48d2a8d990772ba58796dcf`。run-1 から持ち越し再検証された項目。監査成果物: /Users/yaar/security-audit-skill/obsidian-smart-history/run-2/（`NEEDS-VALIDATION.md` 4番 / `FINDINGS-DETAIL.md`）。

発生の連鎖（監査 trace より）:

1. MV3 は `persistent: false` で、`main()` は SW 起動ごとに走る（`entrypoints/background/index.ts:8,14,16`）。
2. `init()` はそのたびに `alarmRegistry.installAll()` を呼ぶ（`src/background/service-worker.ts:66`）。
3. `installAll` は静的スケジュールを持つ全ジョブを**存在確認なしに** `chrome.alarms.create` する（`src/background/alarmRegistry.ts` の installAll。監査ref 175 / 現在HEAD 200）。`yasumaro-daily-purge` は `{ periodInMinutes: 1440 }` で `when` を持たない（監査ref 138 / 現在HEAD 161）。
4. 同名 `create` は既存アラームを置き換えるという置き換えセマンティクスが**ソース自身がコメントで文書化している**（`alarmRegistry.ts:78-85`「Chrome replaces same-name alarms」、および `localMarkdownIdleFlusher.ts:107-113`）。
5. その一方、同じ「日次」 alarms でも `yasumaro-local-md-daily-flush` だけは `ensureDailyFlushArmed()` の get-then-create ガードで守られている（`localMarkdownIdleFlusher.ts:91-105`「Never recreates an armed alarm, so recordings cannot shift the daily timing off midnight」）。**daily-purge 側だけがガードされていない**。
6. 5分周期の `yasumaro-offline-network-retry`（`alarmRegistry.ts:165`）が発火すると停止中SWが復帰 → 2へ戻る。この周期的な起床が24時間カウントダウンを継続的にリセットする。
7. 遅延する実害は `handleDailyPurgeAlarm` に一式ぶら下がっている: 監査ログの**無条件7日スキャン**（`src/background/dailyPurgeHandler.ts:140-141`、cloud AIへ送ったURLの記録）、expired pending pages 掃除、レコード/本文リテンションpurge、設定バックアップ掃除、ダウンロード記録purge、local export バッファ掃出（`dailyPurgeHandler.ts:103-159`）。

**未解決ブロッカー（needs_validation、着手前に潰す）**

- (B1) 同名 `chrome.alarms.create` が「発火待ち中の periodInMinutes アラームの予約発火を置き換え、カウントダウンをリセットする」ことはブラウザプラットフォームの挙動であり、source-only 監査では観測できない（ソースが文書化しているのは置き換えセマンティクスまで）。
- (B2) 「アラーム発火によるコールドスタートで `main() → init() → installAll` が毎回再実行される」こと（`persistent: false` の MV3 ライフサイクル挙動）。隔離テストプロファイルが必要で run-2 では未観測。

監査が提示した検証手順:
- local: 隔離テストプロファイルで展開版を動かし、`chrome.alarms.get('yasumaro-daily-purge').scheduledTime` を記録 → SW を強制復帰 → 再読込し、1440分のカウントダウンがリセットされたかを確認。
- deployment: 所有者が本番データを触らない隔離プロファイルで同じ観測（`scheduledTime` の前後比較）。

## BDD受け入れシナリオ

既存ガード `ensureDailyFlushArmed`（get-then-create / 既存があれば `return`）と同じ挙動に揃える前提で書く。

```gherkin
Scenario: SW再起動が発生しても日次purgeの次回発火時刻が保持される（ハッピーパス）
  Given 拡張機能を起動し、バックグラウンドが再起動しても 24 時間後に走る日次purgeが登録済みである
  When  バックグラウンドが停止し、その後アラームの起床で再度起動する（日常利用中の再起動を複数回模す）
  Then  日次purgeの発火予定時刻は再起動前の値から変わらない（24時間のカウントダウンがリセットされない）
  And   5分周期のオフライン再試行アラームの挙動も変わらない

Scenario: まだ登録されていない場合は初めて登録される（境界）
  Given 拡張機能が新規インストール直後、または開発者プロファイルでアラームが1つも残っていない状態である
  When  バックグラウンドが起動して定期ジョブのセットアップが走る
  Then  日次purgeが24時間周期で新規登録され、次回発火が不定にならない
  And   既存のアラームを誤って消したり、間隔を0や不定にしたりしない

Scenario: 設定変更・別プロファイル移行でアラームが消えた後は再度登録される（境界）
  Given ブラウザの更新や別プロファイルへの移行で、以前登録されていた日次purgeアラームが存在しなくなった
  When  バックグラウンドが起動する
  Then  日次purgeが再び24時間周期で登録され、掃除処理が恒久的に止まったままにならない

Scenario: 1ジョブの失敗が他の定期ジョブの登録を妨げない（副作用ガード）
  Given バックグラウンド起動時に複数の定期ジョブが登録される
  When  いずれかのジョブの登録が失敗する
  Then  失敗したジョブだけがログに記録され、残りのジョブは通常どおり登録される（既存の失敗方針を維持）
```

## 受け入れ基準

- [ ] `yasumaro-daily-purge` は、既に登録済みであれば**再作成せず**、既存のアラームの発火予定時刻をそのまま維持する（`chrome.alarms.get` 相当の存在確認 → あれば return）。
- [ ] 未登録の場合のみ `{ periodInMinutes: 1440 }` で新規登録する（初回登録経路が失われていない）。
- [ ] ガードの挙動が既存の実装 `ensureDailyFlushArmed`（`src/background/localMarkdownIdleFlusher.ts:98-105`）と同一であり、共通化または同一パターンの再利用として reviewers が読める形でコード化されている。
- [ ] `installAll` の逐次ジョブ処理と、ジョブ単位の try/catch による「1件の失敗で全体を止めない」失敗方針が保存されている。
- [ ] 他の静的スケジュールジョブ（特に 5分周期の `yasumaro-offline-network-retry`）は、在りの仕様判断が明示されるまで**挙動を変更しない**（意図的変更なら同PBI内で理由とテストをセットで記載）。
- [ ] 既存テスト `src/background/__tests__/alarmRegistry.test.ts:199`（無条件再作成を pin している）が更新され、「登録済みなら create しない」ケースと「未登録なら create する」ケースの両方が自動テストで固定されている。
- [ ] ブロッカー B1 / B2 の観測結果が PR 記録（観測手順・実測 scheduledTime・結論）に残され、needs_validation の fingerprint が完了記録に引き継がれている。
- [ ] `npm run validate` が緑。

## テスト戦略

**単体（Vitest / `src/background/__tests__/alarmRegistry.test.ts`）— 主戦場**

- ハッピーパス: `chrome.alarms.get` が既存アラームを返したとき、`chrome.alarms.create` が呼ばれない（`toHaveBeenCalledTimes(0)` 相当）。アンカーを先に置き（既知ジョブの install フックが1回解決したことを確認してから）negative を判定する。
- 境界: `chrome.alarms.get` が `undefined` を返したときだけ `create('yasumaro-daily-purge', { periodInMinutes: 1440 })` が1回呼ばれる。
- 境界: `chrome.alarms.get` が失敗（reject）したとき、黙って成功扱いにせず installAll の既存 try/catch がログに記録した上で他のジョブ登録が継続する。
- 回帰: 他の静的スケジュールジョブの create 呼び出し条件が現状から変わらないこと（表駆動で固定）。
- waitPolicy 準拠: `await new Promise(r => setTimeout(r, N))` は禁止。`waitForMock` / `drainMacrotask`（`testDir/waitPolicy.ts`）で完了を待つ。

**統合（Vitest、service-worker モジュールロード経路）**

- `init()` → `alarmRegistry.installAll()` を複数回呼んでも、日次purgeの登録が1回きりの created に収束すること（冪等性の確認）。
- 既存アサーションの維持: `installs the session alarm once per installAll`、`ignores unknown alarm names` などの周辺テストが緑のまま。

**E2E（Playwright）— 最小限**

- 展開版を隔離プロファイルで起動し、`chrome.alarms.get('yasumaro-daily-purge').scheduledTime` を記録 → SW を強制停止・復帰 → 再取得して**不変であること**を観測（ブロッカー B1/B2 の観測を E2E として固定する）。実時間 24h の待ち合わせは不要で、「値が保持されたこと」だけを検証する。
- `--retries=0` で安定実行、`expect.poll` で待機する。

## 実装メモ（実装者向け）

### 対象ファイルと該当行（trace / evidence）

| ファイル | 行（監査ref d49d70a3） | 行（現在HEAD） | 内容 |
|---|---|---|---|
| `entrypoints/background/index.ts` | 14 | 8, 14, 16 | `persistent: false` / 動的 import / `init()` 呼び出し |
| `src/background/service-worker.ts` | 66 | 66 | `void alarmRegistry.installAll()` |
| `src/background/alarmRegistry.ts` | 82 | 78–85 | 「Chrome replaces same-name alarms」のコメント（置き換えセマンティクス） |
| `src/background/alarmRegistry.ts` | 138 | 161 | `yasumaro-daily-purge` の `staticSchedule: { periodInMinutes: 1440 }`（`when` なし） |
| `src/background/alarmRegistry.ts` | 142 | 165 | `yasumaro-offline-network-retry` の `{ periodInMinutes: 5 }`（再起動の引き金） |
| `src/background/alarmRegistry.ts` | 175 | 200 | `chrome.alarms.create(job.name, job.staticSchedule)` の無条件呼び出し |
| `src/background/localMarkdownIdleFlusher.ts` | 95 | 91–105 | `ensureDailyFlushArmed()` の get-then-create ガード（模範） |
| `src/background/dailyPurgeHandler.ts` | 141 | 140–141 | 監査ログ7日スキャンを含む日次purge本体 |
| `src/background/__tests__/alarmRegistry.test.ts` | 199 | 199 | 無条件再作成を pin している既存テスト |

### 最小変更方針

- `installAll` の静的スケジュール登録に **get-then-create ガード**を適用する。該当するのは `alarmRegistry.ts:200` の `chrome.alarms.create(job.name, job.staticSchedule)` の直前（`await chrome.alarms.get(job.name)` → 存在したら `continue`／次の `install` へ）。
- **共通化するかは実装時に判定すること**。`ensureDailyFlushArmed`（`localMarkdownIdleFlusher.ts:98-105`）は「日次アラームを arm する専用責務」で、installAll の表登録責務（どのジョブをいつ再生成するか）とは階層が異なる。共通ヘルパーへ出す場合は `chrome.alarms` の注入ではなく純粋関数（`shouldCreate(name, existing)` 程度）に留め、MV3 固有の副作用責務を持ち越さないこと。deep module の Deletion test（`alarmRegistry.ts` の冒頭コメント）を壊さない範囲が条件。
- `staticSchedule` に `when` が無いジョブは「初回は基準時刻から create、以降は保持」というセマンティクスになる。アラームが消失したあとには再度 create されて自然に復帰する、という副作用は Scenario 3 で固定する。
- **他の静的スケジュールジョブにガードを広げるかは本PBIの範囲外**。`yasumaro-offline-network-retry`（5分周期）の再作成は「周期タイマーの巻き戻し」として実害が小さく、意図的な仕様変更になる可能性があるため、同PBI内で理由とテスト変更をセットで記載するか、follow-up PBI に分ける。

### 着手前に潰すべき検証（ブロッカー）

source-only 監査では到達できない2点が未解決のまま。**実装に入る前に観測結果を記録し、needs_validation → 確定/否定のどちらかに落としたうえで DoD チェックする**:

- **B1**: 同名 `chrome.alarms.create` が発火予約済みの `periodInMinutes` アラームの scheduledTime をリセットするのか（リセットしないなら本 PBI の前提が崩れ、`staticSchedule` の設計自体を再検討）。
- **B2**: アラーム発火によるコールドスタートで `main() → init() → installAll` が毎回走るのか（走らないなら再起動要因はオフラインキュー等の他経路のみに起因し、優先度再評価）。
- 観測手順: 隔離テストプロファイルで展開版をロードし、`chrome.alarms.get('yasumaro-daily-purge').scheduledTime` を記録 → SW を強制停止 → アラーム起床または runtime メッセージで復帰 → 同値を再読込。`NEEDS-VALIDATION.md` 4番の validation plan と同一手順で、生产・共有データに触れない。

### 既存テストの更新要否

**要更新**。`src/background/__tests__/alarmRegistry.test.ts:189-204` は `create` が無条件に `('yasumaro-daily-purge', { periodInMinutes: 1440 })` を呼ぶ前提を pin している。ガード導入後は既存アラームあり／なしの分岐を持つ形に書き換える。テスト内の `globalThis.chrome` スタブに `alarms.get` が無いので、スタブに `get: vi.fn()` を追加する（未定義だと `chrome.alarms.get` が TypeError になり、installAll の try/catch に飲まれて**テストが黙って緑を通る**点に注意）。

### ロールバック手順

- 本変更は 1ファイル（`src/background/alarmRegistry.ts`）＋ テスト1ファイルに閉じており、データ移行・ストレージキー・manifest 権限を触らない。
- 差し戻しは該当コミットの revert のみで完結する。`git revert <commit>` または `alarmRegistry.ts` の installAll ループを無条件 create に戻す。
- ロールバック時に握り潰してはならないのは: 新規に追加したテストアサーション（無条件 create 前提に戻す際、アサーションを消すのではなくガード実装を戻す）、および B1/B2 の観測記録（revert 後も有効な事実として残す）。

### 既実装の確認

- `ensureDailyFlushArmed`（`localMarkdownIdleFlusher.ts:98-105`）は**同じガードを daily-flush に対して実装済み**。daily-purge 側に同じパターンが無いことが本 PBI の指摘点なので、daily-purge 用のガード実装が既に紛れ込んでいる可能性を排除するため、着手時に `grep -rn "alarms.get" src/background/` を実行する。
- ケース: `chrome.alarms.get` によるガードが alarmRegistry 側で既に実装済みなら、本 PBI は「調査・回帰固定」タスクに書き直す。

## 見積もり

**2 SP**（🟢低）。内訳: ブロッカー B1/B2 の観測 0.5 SP / ガード実装と共通化判断 0.5 SP / テスト更新（既存／未登録の分岐 + 既存テスト書き換え）0.5 SP / validate・レビュー・ドキュメント 0.5 SP。単一ファイル＋単一テストファイルに閉じており、1スプリントで完了する。

## Definition of Done

- [ ] BDDシナリオが自動テストで実装されパス
- [ ] `npm run validate` が緑
- [ ] 監査 fingerprint `a0542fe3849d1e6b087798dfea20534f56ff8035b48d2a8d990772ba58796dcf` を完了記録に残す
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（`dev-docs/` 側の日次purge/アラーム所有に関する記述と CHANGELOG）

## 調査結果（2026-10-18）

- 判定: **RESOLVED**（ブロッカー 2 件とも解消）
- 決め手: Chrome docs が「同名 create は既存アラームを cancelled and replaced する」を明記。`periodInMinutes` のみのアラームは `periodInMinutes` が `delayInMinutes` の既定となり、初回発火は作成時刻基準で再計算される。**Chrome docs 自身が get-then-create ガードを推奨コード例つきで提示**しており本 PBI の方針と完全に一致する
- 影響: 実機観測は任意の確認に格下げ。`persistAcrossSessions: true` の明示を実装メモに追加できる

## 関連

- pbi/00-INDEX.md
- /Users/yaar/security-audit-skill/obsidian-smart-history/run-2/NEEDS-VALIDATION.md（4番）
- /Users/yaar/security-audit-skill/obsidian-smart-history/run-2/FINDINGS-DETAIL.md
- dev-docs/TEST_RULE.md（実時間待ちの禁止・waitPolicy）
- dev-docs/ARCHITECTURE_MAP.md（alarmRegistry / service-worker の位置づけ）