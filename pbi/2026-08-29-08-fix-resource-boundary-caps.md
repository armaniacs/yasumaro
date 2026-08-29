# PBI: リソース上限とライフサイクルの境界強制（VULN-004/006/007/024/041/051/053, CWE-400/459）

## ユーザーストーリー
利用者として、拡張のストレージとメモリが長期利用で際限なく膨らんだり、悪意あるページ内容が二次計算を爆発させたりしないようにしたい、なぜなら自動エクスポートが削除されず、purge が死蔵コードで、書き込み境界に上限がなく、AI タグ・文リストが O(n²) 計算に無制限に入るから

## ビジネス価値
- VULN-004: 自動 `local_export_*` ダウンロードが削除されず 8.9GB/5年モデル（実証）
- VULN-006: `clearExpiredPages` が 0 呼び出しで期限切れ pending が永久滞留（実証: 1000 件滞留）
- VULN-007: 攻撃者 Cache-Control 値が無 cap で storage.session に永続化（実証: 6 応答で quota 超過）
- VULN-024: payloadGuard が 3/7 TEXT 列のみ cap（実証: 1000MB tags 通過）
- VULN-041/051/053: 無 cap タグ/文が O(n²) 計算に流入（実証: x4 n で x29 時間、116GB edge model）
- 測定方法: 書き込み境界での cap 強制、purge 配線、schema 駆動 guard の 3 点

## 優先度
- 順位: 8 / 14
- RICEスコア: 1080（Reach=800 / Impact=0.3 / Confidence=90% / Effort=0.2人月）
  - Reach 800: 長期利用の全利用者（無限成長は時間依存で必ず顕在化）
  - Impact 0.3: 可用性・ストレージ健全性（データ消失ではない）
  - Confidence 90%: 既存 precedent（1024 文字 truncate、50 タグ cap、日次 purge alarm、schema SSOT）が存在し配線/適用が本体
  - Effort 0.2: 7 指摘だが各々が小修正（配線 2、truncate 1、guard 1、cap 3）
- 根拠: 根本原因が共通（RC: 上限が表示/読み取り側に置かれ書き込み境界で強制されない）

## BDD受け入れシナリオ

```gherkin
Scenario: 自動エクスポートは retention 内で削除される
  Given 30 日より古い local_export_* ファイルが存在する
  When 日次 purge alarm が走る
  Then 古いエクスポートが削除され、総バイト数が cap 内に収まる

Scenario: 期限切れ pending ページは日次 purge で消える
  Given 期限切れの pending ページが 1000 件ある
  When 日次 purge alarm が走る
  Then clearExpiredPages が実行され、リストが縮む

Scenario: 攻撃者の巨大ヘッダ値は書き込み境界で truncate される
  Given 10KB の Cache-Control 値を含む応答が来る
  When privacyChecker が PrivacyInfo を構築する
  Then 値は 1024 文字で truncate され storage に収まる

Scenario: payloadGuard は schema の全 TEXT 列を cap する
  Given 1000MB の tags を含む SQLITE_INSERT が来る
  When payloadGuard が検証する
  Then tags も schema 由来の cap で拒否/切断される

Scenario: 無制限タグ/文は二次計算に入る前に cap される
  Given SQLite 経路に 500 タグ/レコードが保存されている
  When tagCooccurrence / TextRank / tagClusterLayout が実行される
  Then 入力が cap（50 タグ/文数上限/ノード top-N）され、計算時間が有界になる
```

## 受け入れ基準
- [ ] `src/background/localMarkdownExportCore.ts:38-69` が download ID を記録し、日次 purge alarm で retention（30 日想定）＋総量 cap を適用する
- [ ] `src/utils/pendingStorage.ts:199-212` の `clearExpiredPages` が日次 purge alarm から呼ばれ、addPendingPage のしきい値経由でも実行される
- [ ] `src/utils/privacyChecker.ts:47-62` が `cacheControl.value` を 1024 文字で truncate する
- [ ] `src/offscreen/payloadGuard.ts:68-125` が schema（`src/offscreen/schema.ts:69-102` の全 TEXT 列）駆動で各列＋合計を cap し、未知フィールドを fail-closed にする
- [ ] `src/offscreen/sqliteMessageHandlers.ts:122-164`（SQLite 経路のタグ cap 50）と `tagCooccurrence.ts:36-41` / `sentenceExtractor.ts:91-101` / `tagClusterLayout.ts:69-90` の入力 cap が実装されている
- [ ] `npm run type-check` と `npm run validate` が成功する
- [ ] VulnHunter 再検証: 7 指摘の PoC が全て失敗する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象なし（alarm/purge はモックで検証）

### 統合テスト
- dailyPurgeHandler × downloads モック: retention 削除の統合
- SQLITE_INSERT × payloadGuard: schema 駆動 cap の統合

### 単体テスト
- 新規: `payloadGuardSchemaDriven.test.ts`（列追加が自動で cap 対象になること）
- 新規: 各 cap の境界値テスト（1024 文字ちょうど、50 タグちょうど、top-N 末端）
- 更新: TextRank/cooccurrence/layout の性能テスト（n 倍→時間の次数が落ちること）

## 実装アプローチ
- **Outside-In**: purge 配線（004/006）を先に（既存 alarm 経路への hook のみ）→ truncate（007）→ guard（024）→ cap 3 件
- **Red-Green-Refactor**: cap 値は既存 precedent に合わせ、新規判断を持ち込まない

## 見積もり
2pt（要チームでの見積もり — 配線 2、truncate 1、guard 再構築 1、cap 3）

## 技術的考慮事項
- 依存関係: Wave 2。PBI 05（limit clamp）とは別ファイル（conflict なし）
- テスタビリティ: purge alarm は FakeAlarmPort（既存 PBI 2026-08-27-24 のパターン）で検証可能
- 非機能要件: truncate/cap による正規データの欠損は既存表示挙動と同等以内
- 注意: tagClusterLayout の top-N は計算頻度の高い panel なので UX 劣化を計測すること

## 実装者向け注記

### 現状コードの確認
```bash
sed -n '35,70p' src/background/localMarkdownExportCore.ts
sed -n '195,215p' src/utils/pendingStorage.ts
sed -n '44,64p' src/utils/privacyChecker.ts
sed -n '65,128p' src/offscreen/payloadGuard.ts
sed -n '118,168p' src/offscreen/sqliteMessageHandlers.ts
```

### 実装手順
1. dailyPurgeHandler に export retention と clearExpiredPages を配線
2. privacyChecker truncate
3. payloadGuard の schema 駆動化（未知フィールド拒否）
4. sqlite タグ cap＋3 二次計算の入力 cap
5. テスト追加、`npm run validate`

### 落とし穴
- payloadGuard の schema 駆動化で `changes`（update 用）経路もカバーすること（既存は INSERT 系のみ）
- retention の削除は chrome.downloads.removeFile + removeDownload の API 制約を確認（ID の記録形式）
- 文数 cap は 64KB truncation 後に効く（sentence 数は budget 依存）— cap は minLength 越え文に限定すること

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] VulnHunter 再スキャンで VULN-004/006/007/024/041/051/053 が解消されること
