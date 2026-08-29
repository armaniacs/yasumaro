# PBI: レスポンスボディ読み込みのバイト上限ユーティリティ（VULN-013/015/027/054/055, CWE-400）

## ユーザーストーリー
利用者として、悪意ある/侵害されたリモート（Obsidian・AI プロバイダ・Tranco・GitHub・フィルタ URL）が巨大な chunked 応答を返しても拡張が停止しないようにしたい、なぜなら現在のサイズ上限が Content-Length ヘッダ（攻撃者が省略可能）に依存し、`response.text()/json()` が SW メモリを無制限に消費するから

## ビジネス価値
- 5 指摘・8 シンクを 1 ユーティリティで解消（実証: 64–200MB の確保、chunked で上限無効化）
- MV3 Service Worker のメモリ枯渇による拡張全体 DoS（録画状態の喪失）を封鎖
- 測定方法: 全 8 シンクが `readBodyCapped` を経由すること、Content-Length なしで cap が強制されること

## 優先度
- 順位: 3 / 14
- RICEスコア: 1663（Reach=1000 / Impact=0.35 / Confidence=95% / Effort=0.2人月）
  - Reach 1000: 任意サイトの応答ヘッダ（VULN-013 の Obsidian 経路、Tranco 経路）・configured endpoint で到達
  - Impact 0.35: 拡張全体 DoS（データ消失ではなく可用性）
  - Confidence 95%: スイープで 12 本番シンク中 8 シンクが攻撃到達可能と特定済み。ユーティリティ 1 本で完結
  - Effort 0.2: ユーティリティ新設＋8 シンク置換＋テスト
- 根拠: 根本原因（RC-3: ヘッダ条件付き上限＋素の body 読み取り）が全 5 指摘で同一のため、1 ユーティリティが正攻法

## BDD受け入れシナリオ

```gherkin
Scenario: Content-Length なしの chunked 応答はバイト上限で打ち切られる
  Given リモートが cap を超える chunked 応答を返す
  When readBodyCapped で本文を読む
  Then 読み取りは maxBytes で中断され、エラー（または打ち切り結果）が返り SW メモリは上限内に保たれる

Scenario: Content-Length が嘘/省略でも cap は守られる
  Given Content-Length: 100 を申告しつつ 1GB を返す応答が与えられる
  When 読み取りを実行する
  Then ヘッダに依存せず実バイト数で cap される

Scenario: 通常サイズの応答は現行どおり動作する（回帰防止）
  Given cap 内の正当な応答が与えられる
  When 各シンク（Obsidian/FETCH_URL/Tranco/AI/Gist）が読む
  Then 現行と同一のパース結果が返る

Scenario: 上限超過はログに記録され処理が継続する
  Given cap を超える応答が与えられる
  When 呼び出し元（例: saveToObsidianStep）が失敗を処理する
  Then 既存のエラー分類に沿って記録され、パイプライン全体は停止しない
```

## 受け入れ基準
- [ ] `src/utils/readBodyCapped.ts`（仮称）が新設され、バイトカウント付きストリーミング読み取り＋cap 超過中断を実装している
- [ ] 以下 8 シンクが `readBodyCapped` に置換されている: `obsidianConfigValidator.ts:143-151`、`obsidianClient.ts:166,193-199`、`systemHandlers.ts:98-108`（FETCH_URL）、`trancoUpdater.ts:147-155`、`GeminiProvider.ts:134,232`、`OpenAIProvider.ts:183,251`、`gistSyncTarget.ts:170`
- [ ] 既存の post-read チェック（systemHandlers.ts:107 等）は防御深度として維持されている
- [ ] Gist の素 fetch（`gistSyncTarget.ts:120,147,175`）も `fetchWithTimeout` 経由に統一されている
- [ ] 新規テストで「chunked 超過」「嘘ヘッダ」「cap 内正常系」「各シンク経由」が検証されている
- [ ] `npm run type-check` と `npm run validate` が成功する
- [ ] VulnHunter 再検証: `response.text()/json()` の素使用が上記シンクで 0 件

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象なし（ローカル HTTP モックで十分。実環境計測は PoC に委譲）

### 統合テスト
- `ObsidianClient.appendToDailyNote` 経由: 巨大 chunked 応答で cap エラーが既存エラー分類に乗ること
- `FETCH_URL` handler 経由: 超過応答が拒否され、保存済み cap エラーメッセージが維持されること

### 単体テスト
- 新規: `src/utils/__tests__/readBodyCapped.test.ts`
  - ビジネスロジック: cap 内/超過の読み取り結果
  - 境界値: cap ちょうど、cap+1、空 body、1 バイト chunk
  - 例外: reader 異常終了、content-length 不一致
- 更新: 各シンクの既存テストに cap 経由の呼び出し検証を追加

## 実装アプローチ
- **Outside-In**: まず `readBodyCapped` の単体テストを Red にし、実装で Green。次に 8 シンクを 1 つずつ置換し、各置換後に既存テストを実行
- **Red-Green-Refactor**: cap 値は現行値（Obsidian 10MB/1MB、FETCH_URL 10MB、Tranco 50MB、AI/Gist は既定 10MB）を踏襲

## 見積もり
2pt（要チームでの見積もり — ユーティリティ＋8 シンク置換＋テスト）

## 技術的考慮事項
- 依存関係: なし（Wave 1 推奨）。ただし PBI 10（log-integrity）と `systemHandlers.ts` を共有 → マージ順に注意
- テスタビリティ: `Response` をモックし `body.getReader()` でチャンク制御
- 非機能要件: 正常系の性能劣化なし（ストリーミングは現行と同 O(n)）
- 注意: `response.json()` 依存の Gemini/OpenAI/Gist は、cap 後に `JSON.parse` する形へ変更（意味不変）

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "response\.(text|json)\(\)" src --type ts -g '!**/__tests__/**'
sed -n '140,155p' src/utils/obsidianConfigValidator.ts
sed -n '95,110p' src/background/handlers/systemHandlers.ts
```

### 実装手順
1. `readBodyCapped(response, maxBytes): Promise<string>` を新設（`response.body.getReader()` ループ＋カウンタ）
2. Obsidian 2 シンク → FETCH_URL → Tranco → AI 4 シンク → Gist の順に置換
3. Gist を `fetchWithTimeout` 経由に統一
4. テスト追加、`npm run validate`

### 落とし穴
- `response.json()` を `readBodyCapped` 後の `JSON.parse` に置き換える際、型アサーションを維持すること
- cap 超過のエラーを無視して null を返すと呼び出し元が TypeError で落ちる — 既存エラー分類（`errorUtils`）に乗せること
- Obsidian の 1MB バリアント（`obsidianClient.ts:193-199`）と 10MB の両方の cap 値を維持すること

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] VulnHunter 再スキャンで VULN-013/015/027/054/055 が解消されること
