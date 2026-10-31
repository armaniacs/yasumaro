# PBI: Obsidian Read-Modify-Write 競合の影響調査

## ユーザーストーリー
保守担当者として、Obsidian 同時編集時の Read-Modify-Write 競合の実影響を把握したい、なぜなら軽減策（hash 前提条件付き PUT 等）の要否とコストを判断する材料が不足しているから。

## 優先度
- 順位: 9 / 9（全候補）
- RICEスコア: 0.5（Reach=1 / Impact=0.5 / Confidence=50% / Effort=0.5人週）
- 根拠: README が「Obsidian 側でまさにその瞬間に同じファイルを編集していると、競合により更新内容が失われるリスクがわずかにある」と自認する受容リスク。拡張内ではグローバル Mutex（`src/background/` 側の直列化）で守られているが、Obsidian アプリ側で同一ファイルを編集中の競合は未防御で、hash 前提条件なしの PUT になっている。調査のみでコード変更をしないため Effort は小さいが、軽減策の実装判断（別 PBI）の前提になる

## ビジネス価値
競合の発生条件と頻度、軽減策の選択肢が整理されると、次の 3 つに移行できる。

- 軽減策を実装する場合: 実装 PBI の受け入れ基準を競合条件から具体的に書ける
- 軽減しない場合: README の注意書きが「なぜ軽減しないか」の根拠つきになり、受容判断が記録に残る
- 中間の場合: 間引きや再読み込み検証など、コストの小さい軽減だけ採用できる

測定方法: 調査報告に「発生条件・API 対応可否・軽減策の選択肢とコスト・推奨」が含まれること。調査型 PBI の完了条件は行動に移れる報告であり、コード変更ではない。

## BDD受け入れシナリオ

```gherkin
Scenario: 調査報告に競合の発生条件が含まれる
  Given この PBI が着手されている
  When  調査報告が書き出される
  Then  Obsidian 側で同一ファイルを編集中の競合が発生する条件が、自動保存 / 今回のみ保存 / 自動保存の書き込み間隔の観点で整理されている
  And   競合発生時のユーザー可視性（エラー表示の有無、obsidian_sync の recovery 経路の挙動）が記載されている

Scenario: 調査報告に軽減策の選択肢と推奨が含まれる
  Given 競合の発生条件が整理されている
  When  Obsidian Local REST API の公式ドキュメントで書き込み系メソッド（PATCH / If-Match / hash 前提条件の有無）を確認する
  Then  軽減策の選択肢がコストつきで列挙されている
  And   推奨が明記され、実装する場合は別 PBI として起票する旨が記載されている
```

## 受け入れ基準
- [x] 競合の発生条件が、拡張側（obsidianClient の Read-Modify-Write 手順）と Obsidian 側（編集中の状態）の両面から整理されている
- [x] Obsidian Local REST API の公式ドキュメントから、PATCH / If-Match / hash 前提条件付き書き込みの対応可否が確認されている
- [x] 競合発生時のユーザー可視性（エラー表示の有無、recovery 経路）が記載されている
- [x] 軽減策の選択肢がコストつきで列挙され、推奨が明記されている
- [x] この PBI 自体ではコード変更を行っていない（軽減策の実装は報告後の別 PBI）
- [x] 実測（手動テスト）が必要な項目は owner 手動項目として分離されている

## テスト戦略
調査型のため自動テスト対象外。検証は次の手順で行う。

1. 調査報告が受け入れ基準の項目をすべて含むことを確認する
2. 発生条件の記述が「観測可能な条件と頻度の推定」に留まっていることを確認する（断定しすぎないこと）
3. 推奨軽減策に次のアクション（実装 PBI の起票、または README 注意書きの強化）が付いていることを確認する

## 調査結果

調査日: 2026-10-31。結論は「必ず起こる」「決して起こらない」のどちらにも断定しない。以下は観測可能な条件と頻度の推定に留める。

### 1. 拡張側の Read-Modify-Write 手順と競合ウィンドウ

- 書き込みは `appendToDailyNote`（src/background/obsidianClient.ts:246）で行う。手順は GET（`_fetchExistingContent`、:282）→ セクション挿入（`NoteSectionEditor.insertIntoSection`、:265）→ PUT（`_writeContent`、:323）。
- 競合ウィンドウは、GET の本文読み込みで既存内容を確定してから、PUT が Obsidian 側で適用されるまで。リクエスト 1 個あたり `FETCH_TIMEOUT_MS = 15000`（obsidianClient.ts:47）で抑えられ、ローカルループバックでは通常ミリ秒から数百ミリ秒の推定。リクエストが固まった場合はタイムアウトまで最大 15 秒ずつ残る。
- 拡張内の書き込みは、RMW 全体を包む書き込み Mutex（モジュールシングルトン `globalWriteMutex`、obsidianClient.ts:102、キューサイズ 50 / タイムアウト 30 秒）で直列化され、GET から PUT まで含めて同時に 1 件しか走らない。Per-URL Mutex（perUrlMutexMap）も同一 URL の同時記録を直列化する。拡張内部同士の競合はこの構造で防がれている。
- 未防御なのは Obsidian アプリ側の編集。PUT は GET 時点のスナップショットに拡張の追記を載せた全体で上書きするため、ウィンドウ内に Obsidian 側の編集がディスクへ反映されると、その編集は PUT で失われる。
- 逆方向の損失もありうる: Obsidian エディタが未保存のバッファを持つ状態で拡張の PUT が通ると、その後のエディタ側保存がバッファで上書きし、拡張の追記が失われる可能性がある。Obsidian の外部変更検出の挙動に依存するため、実測が必要（owner 手動項目）。
- ノートが存在しない場合（GET が 404、obsidianClient.ts:300）は空文字を起点に末尾へ新規セクションを作る。既存内容が無いため既存編集を失う経路にはなりにくいが、GET と PUT の間に他クライアントが同じファイルを作る稀なケースは残る（If-None-Match: * で塞げる）。

### 2. 書き込みの発生源と発生条件の整理

- 自動保存: コンテンツスクリプトが滞在時間（既定 5 秒）とスクロール深度（既定 50%）の閾値を満たしたページで VALID_VISIT を送り、記録 1 件につき RMW 1 周が走る（src/background/handlers/recordingHandlers.ts:99 の VALID_VISIT ハンドラ、:141 の `buildRecordRequest('valid-visit', ...)`）。
- 今回のみ保存: popup / アクティブタブからの MANUAL_RECORD（src/background/handlers/activeTabRecorder.ts:76、recordingHandlers.ts:264 の `buildRecordRequest('manual', ...)`）。ユーザー操作起点なので、その瞬間にデイリーノートを編集中という条件が重なる可能性が相対的に高い。
- 自動保存の書き込み間隔: トリガー設定 `periodicSnapshot` と `SNAPSHOT_INTERVAL_MINUTES`（既定 5 分、src/background/recordingTriggerManager.ts:159-166）が存在するが、alarmRegistry に snapshot 起点のアラーム登録はなく、`shouldRecord` の呼び出し箇所も現行ツリーに見つからない。定期スナップショットは設定だけ残る休止状態で、実効的な書き込み源は自動保存と今回のみ保存。
- 3 つ目の書き込み源がオフライン再生: obsidian_sync ジョブを 5 分間隔のアラーム（yasumaro-offline-network-retry、src/background/alarmRegistry.ts:212）が再生し、`retryObsidianWrite` → SavePhase.saveRetry で再書き込みする。再生時はその時点で改めて GET するため、競合ウィンドウは再生時刻に開く。
- 再生書き込みのみ `dedupe: true`（src/background/pipeline/steps/saveToObsidianStep.ts:62、src/background/noteSectionEditor.ts:27）で同一ブロックの重複スタックを防ぐ。初回パイプライン実行とユーザー起因の追記は無条件挿入。
- 発生条件の整理: 競合は (a) ユーザーが当日のデイリーノートを Obsidian で編集中、(b) その編集がウィンドウ内にディスクへ反映される、(c) 拡張の GET が編集の反映前に完了し PUT が反映後に完了する、の重なりで起こる。書き込み先は日付ごとの同一ファイルに集中するため、閲覧しながら当日のノートを編集する時間帯に暴露が偏る。書き込み頻度の実測は owner 手動項目。

### 3. Obsidian Local REST API の対応可否

確認日: 2026-10-31。参照: https://github.com/coddingtonbear/obsidian-local-rest-api （master README。manifest.json の version 5.5.2 / minAppVersion 1.13.1 を同時確認）。

- `PATCH /vault/{path}` は対応済み。JSON 命令で operation（replace / prepend / append / delete）を、target（heading / block / frontmatter）と scope（content / marker / markerAndContent / parent）付きで適用する。
- `If-Match`（ETag 前提条件付き書き込み）は対応済み。`/vault/{path}` と `/active/` の PUT / POST / PATCH / DELETE、MOVE / COPY、heading / block / frontmatter への対象指定書き込みすべてで使える。GET の ETag ヘッダ、ドキュメントマップの version、直前の書き込み応答の ETag は同一トークン。不成立時は 412（エラーコード 41200）で、メッセージが現在のバージョンを伝える。新規作成専用には `If-None-Match: *` がある。API 経由の書き込みはファイル単位でキューイングされ、同一バージョンを持つ 2 クライアントが同時に通ることはないと明記されている。
- 拡張（ブラウザ）からも利用できる: API は `Access-Control-Expose-Headers: *` を返すため、拡張の fetch でも `response.headers.get('ETag')` で ETag を読める。認証は Bearer トークン（現行実装と同じ）で、`credentials: "include"` は非対応。
- セクション対象指定の書き込みも可能: `PUT /vault/{path}/heading/見出し` でその見出しの内容だけを差し替え、`POST` で追記できる。ファイル全体の PUT より上書き範囲を狭められる。
- 注意: 確認は現行 master（5.5.2）の README に対するもので、If-Match / ETag の対応はプラグインのバージョンで変わる可能性がある。実装時はインストール済みプラグインの GET 応答に ETag ヘッダがあることを実行時に検出してから使うこと（古いバージョンでの挙動は未確認）。

### 4. 競合発生時のユーザー可視性

- 拡張の PUT が成功したケース（競合で Obsidian 側の編集が失われたケース）: エラー表示は一切ない。INFO ログ `Saved to Obsidian`（saveToObsidianStep.ts:68）と保存成功の Chrome 通知（src/background/pipeline/recordingOutcome.ts:252 → src/background/pipeline/resultBuilder.ts:101）が出る。ユーザーは Obsidian 側で編集が消えたことに、拡張からは気づけない。
- 拡張の PUT が失敗したケース（ネットワーク系）: saveObsidian は BEST_EFFORT（src/background/pipeline/savePhase.ts:98-101）で同一 request 内の再試行がなく、StepExecutor が failure kind network / timeout を判定して obsidian_sync をオフラインキューへ投入する（src/background/pipeline/stepExecutor.ts:67、src/background/pipeline/retryPolicy.ts:50）。この直後にユーザーへの通知は出ない（decideStepOutcome の BEST_EFFORT 経路、recordingOutcome.ts:173-184）。以降の recovery 経路は次の通り。
  - obsidian_sync ジョブは 5 分間隔のアラームで再生される（alarmRegistry.ts:212、src/background/offlineQueueProcessor.ts:113）。recovery claim（src/utils/recoveryClaimStore.ts）で手動再実行との二重実行を防ぐ。再試行 3 回を使い切ると（≒ 15 分）、pending ページ登録と「再試行を使い切った」通知が 1 回だけ出る（offlineQueueProcessor.ts:54-73）。
  - ネットワーク系でない失敗（5xx の kind http、auth、rate_limit）はオフラインキューに入らず、pending ページ（reason `obsidian-write-failed`、TTL 24 時間、src/utils/pendingStorage.ts:92）だけが登録される（recordingOutcome.ts:246-248）。即時の通知はない。
  - pending ページは popup の pending 一覧（src/popup/pendingPages.ts）から再実行できる。
- まとめ: 競合そのものを検出する経路は現行コードにない。エラー表示があるのは PUT が失敗した場合のみで、競合で書き込みが「成功して上書きする」ケースは無表示のまま通る。

### 5. 軽減策の選択肢とコスト、推奨

| 選択肢 | 内容 | コスト | 効果・備考 |
|---|---|---|---|
| If-Match 付き PUT（推奨） | GET の ETag を採って PUT に If-Match を付け、412 を受けたら再 GET → 再挿入 → 再 PUT を 1〜2 回。404（ノート未作成）は If-None-Match: * か現行どおり無条件 | 小。obsidianClient 内の変更のみで済む。412 は failureTaxonomy では kind http に分類されるため、実装は status 412 を明示分岐する必要がある | ウィンドウ内の Obsidian 側変更を検出して 412 で止められる。API 側のファイル単位キューイングも効く。ETag を返さない古いプラグインでは現行動作へフォールバック |
| PATCH 命令への置き換え | セクション見出しを target にした append 命令（ifMatch 併用）でサーバー側挿入に切り替える | 中。命令 JSON の構築、警告ヘッダ（Markdown-Patch-Warnings）、見出しが無い場合の作成フォールバック、エラー対応が必要。既存セクションヘッダ（h1）と PATCH の見出し扱いの整合確認も要る | 既存セクションへの追記でクライアント側の全体 RMW をなくせる。競合検出自体は If-Match 併用時のみ |
| 書き込み前の再読み込み検証 | 書き込み直前にもう一度 GET し、内容が変わっていなければ続ける等の再確認 | 小〜中。独自実装 | 直前再確認の間に編集が入れば検出できるが、その後のウィンドウは残るので 0 にはならない |
| SSE イベントストリームで同時編集を監視 | vault modify を購読して競合を検知 | 大。常時接続を持ち込むため、軸5（保守は個人規模、常駐プロセスやサーバーを持ち込まない）に反する | 採用しない |
| README 注意書きの強化 | 「なぜ軽減しないか / 軽減する場合の条件」を受容判断として追記 | 0（文書のみ） | 軽減しない場合の記録として残る |

推奨: If-Match 付き PUT。コストが最小で、競合を「見えない上書き」から「検出可能な 412」に変えられるため。実装する場合は別 PBI として起票する。軽減しない場合は README の注意書きに受容根拠を追記する。

### 6. owner 手動項目（実測が必要なもの）

- Obsidian で当日のデイリーノートを開いたまま編集し、拡張の自動保存 / 今回のみ保存と重ねて、編集が失われるかと失われる方向を確認する。
- Obsidian エディタに未保存バッファがある状態で拡張が書き込んだとき、その後のエディタ側保存がどうなるか（外部変更検出の挙動）を確認する。
- 自動保存が 1 日に何回書き込むかをデバッグログで確認し、競合への暴露頻度を推定する。
- インストール済み Obsidian Local REST API のバージョンと、GET 応答に ETag ヘッダがあるかを確認する。

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）

```bash
grep -rn "obsidianClient\|Read-Modify-Write" src/background/ README.md | head -20
grep -rn "obsidian_sync\|recovery" src/background/ | head -10
```

README の「Obsidianへの追加の仕組み（src/background/obsidianClient.ts）」セクションに Read-Modify-Write の手順と競合の注意書きがある。設計仕様の §9.3（Request Behavior）も参照。

### 実装手順
1. obsidianClient の Read-Modify-Write 手順（GET → 加工 → PUT）を読み、競合が起こりうるウィンドウ（GET から PUT の間）を特定する
2. 自動保存 / 手動保存（今回のみ保存）/ 自動保存の書き込み間隔を確認し、競合の発生条件を整理する
3. Obsidian Local REST API の公式ドキュメントで、書き込み系メソッドの対応可否（PATCH / If-Match / hash 前提条件の有無）を確認する
4. 競合発生時の挙動（エラー表示の有無、recovery 経路）をコードから確認する
5. 実測が必要な項目（実際に Obsidian を開いたまま編集する等）を owner 手動項目として分離する
6. 軽減策の選択肢をコストつきで列挙し、推奨を明記して報告する

### 落とし穴
- 調査の結論を「必ず起こる」「決して起こらない」のどちらにも断定しないこと。観測可能な条件と頻度の推定に留める
- Obsidian Local REST API の対応可否は、プラグインのバージョンで変わる可能性がある。確認日と参照 URL を報告に残すこと
- 軽減策を提案する場合、軸5（保守は個人規模）に照らして、常駐プロセスやサーバーを持ち込む案は採用しないこと

## 見積もり
1pt目安（0.5人週相当）

## Definition of Done
- [x] 調査報告（発生条件・API 対応可否・ユーザー可視性・選択肢とコスト）が完成
- [x] 推奨軽減策と次のアクション（別 PBI 起票、または受容の記録）が明記されている
- [x] 報告レビュー完了

## 参照
- ブレスト報告書: docs/superpowers/specs/2026-10-31-next-phase-do-dont-design.md（仕様ギャップ G4）
- README.md の Obsidian 統合セクション（競合の注意書き）
- 設計仕様書: dev-docs/DESIGN_SPECIFICATIONS.md §9.3
