# PBI: ローカル Markdown エクスポートの retention（VULN-004, CWE-400/459）

> `2026-08-29-08-fix-resource-boundary-caps.md` から分離。PR #75 では
> payloadGuard schema 駆動化・Cache-Control truncate・clearExpiredPages 配線が
> 着地した。本 PBI は自動エクスポートの無限成長を扱う。

## ユーザーストーリー
利用者として、ローカル Markdown 自動エクスポートが長期利用でディスクと `chrome.downloads` 履歴を際限なく消費しないようにしたい、なぜなら日次バッファのエントリ数に上限がなく、`chrome.downloads` のダウンロード記録が retention なしに蓄積するから

## 背景

### 現状（PR #75 着地後）
`src/background/localMarkdownExportCore.ts` の `flushBufferedExports`:
- 日次バッファキー `local_export_YYYY-MM-DD` を全ストレージ走査で列挙
- 各日付を `chrome.downloads.download({ filename: '${exportPath}/${date}.md', conflictAction: 'overwrite' })` で書き出し

### VULN-004 の実態（要精査）
- **ファイル自体**: `conflictAction: 'overwrite'` + 日付固定ファイル名のため、1 日 1 ファイルで上書き。ファイル数は日数分（365/年）で有界。ただし**日次バッファのエントリ数に上限がない**ため 1 ファイルのサイズは無制限（1 日の訪問数 × エントリサイズ）
- **`chrome.downloads` 履歴**: `download()` を呼ぶ度にダウンロード記録が作られ、`removeDownload` しない限り蓄積。長期利用で数千件
- **古い日次バッファキー**: フラッシュ後も `local_export_*` キーが `chrome.storage.local` に残る場合、retention なしに蓄積（`flushBufferedExports` がフラッシュ後にキーを削除しているか要確認）

### PBI 実測モデル
監査レポートの「8.9GB/5年」は日次バッファの蓄積 + downloads 履歴 + 未削除キーの複合と推定。

## BDD受け入れシナリオ

```gherkin
Scenario: フラッシュ後の日次バッファキーは削除される
  Given local_export_2026-01-01 が正常にフラッシュされた
  When flushBufferedExports が完了する
  Then chrome.storage.local の local_export_2026-01-01 キーが削除されている

Scenario: 古いダウンロード記録は retention で削除される
  Given retention（30 日想定）より古い local_export の download 記録が存在する
  When 日次 purge alarm が走る
  Then chrome.downloads.removeDownload（必要なら removeFile）で古い記録が削除される

Scenario: 日次バッファのエントリ数に上限がある
  Given 1 日に 10000 件の訪問があり local_export_YYYY-MM-DD に蓄積される
  When エントリ追加時
  Then バッファは MAX_DAILY_BUFFER_ENTRIES（例: 2000）で古いものから切り詰められる、または追加が拒否される

Scenario: 通常運用のエクスポートは影響を受けない
  Given 1 日数十件の通常訪問
  When 日次フラッシュが走る
  Then 現行どおり YYYY-MM-DD.md が上書き生成され、retention 内の記録は保持される
```

## 受け入れ基準
- [ ] `flushBufferedExports` がフラッシュ成功後に該当 `local_export_YYYY-MM-DD` キーを `chrome.storage.local` から削除する（既に削除しているなら現状維持を明記）
- [ ] `src/background/localMarkdownExportCore.ts` が生成した download の ID を記録する（`chrome.storage.local` に `{ downloadId, date, createdAt }[]` 形式、上限件数あり）
- [ ] `src/background/dailyPurgeHandler.ts` の `handleDailyPurgeAlarm` が retention（`LOCAL_MARKDOWN_EXPORT_RETENTION_DAYS`、既定 30）より古い download 記録を `chrome.downloads.removeDownload` で削除する。`removeFile` の API 制約（既に消えたファイルへの呼び出しは無害か）を確認しコメント化
- [ ] 日次バッファのエントリ数上限（`MAX_DAILY_BUFFER_ENTRIES`、既存 precedent を確認。なければ 2000 程度）が `MarkdownBufferManager` の追加経路で強制される
- [ ] retention 日数を設定 UI に露出するか、定数のままにするかを決定（露出しないなら理由をコメント）
- [ ] `npm run type-check` と `npm run validate` が成功する
- [ ] VulnHunter 再検証: VULN-004 の PoC（長期蓄積モデル）が失敗する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象なし（`chrome.downloads` / alarm はモック）

### 統合テスト
- `handleDailyPurgeAlarm` × `chrome.downloads` モック: retention 超過記録の削除
- `flushBufferedExports` × storage モック: フラッシュ後のキー削除

### 単体テスト
- 新規: `src/background/__tests__/localExportRetention.test.ts`
  - download ID 記録の形式・上限
  - retention 判定の境界（29 日 / 30 日 / 31 日）
  - `MAX_DAILY_BUFFER_ENTRIES` の切り詰め

## 実装アプローチ
- **調査先行**: `flushBufferedExports` がキー削除しているか、`chrome.downloads.removeDownload`/`removeFile` の挙動、`FakeAlarmPort` パターン（PBI 2026-08-27-24）
- **Outside-In**: retention テスト（RED: 古い記録が残る）→ ID 記録 + purge 配線（GREEN）→ バッファ上限

## 見積もり
2pt（要チームでの見積もり — ID 記録 1 + purge 配線 0.5 + バッファ上限 0.5）

## 技術的考慮事項
- 依存関係: PR #75（29-08）が `dailyPurgeHandler.ts` を触っている — マージ順に注意
- `chrome.downloads.removeFile` はユーザーが手動で移動/削除したファイルに対しては失敗する — try/catch で握りつぶし、`removeDownload` は必ず実行
- download ID 記録の上限を超えた場合、古い ID から捨てる（記録自体が無限成長しないように）
- 行番号は監査時点（2026-08-29）のもの。着手時に該当シンボルで再確認すること

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "chrome.downloads|local_export_|DAILY_BUFFER_PREFIX|removeFile|removeDownload" src/background/localMarkdownExportCore.ts
rg -n "handleDailyPurgeAlarm|FakeAlarmPort|clearExpiredPages" src/background/dailyPurgeHandler.ts
rg -n "local_export_" src --type ts -g '!**/__tests__/**'
```

### 実装手順
1. `flushBufferedExports` のフラッシュ後キー削除を確認/追加
2. download ID 記録用ストレージキー + 記録ロジック（上限付き）
3. `handleDailyPurgeAlarm` に retention purge を配線
4. `MarkdownBufferManager` 追加経路にエントリ数上限
5. テスト追加、`npm run validate`

### 落とし穴
- 全ストレージ走査（`chrome.storage.local.get()` 無引数）は既存コメントで正当化済み — キー削除もこの経路で
- retention の起点は download 生成時刻（`createdAt`）であってファイル日付ではない
- `MAX_DAILY_BUFFER_ENTRIES` の切り詰めで「古い訪問が要約から消える」UX 影響を許容範囲か確認

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] VulnHunter 再スキャンで VULN-004 が解消されること
