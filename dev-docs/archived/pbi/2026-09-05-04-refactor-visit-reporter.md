# PBI 04: VALID_VISIT ペイロード構築を VisitReporter に一本化

優先度: 4 位 / RICE 13.3 = (5 × 2 × 80%) / 0.6w / Strength: Strong
backlog: [2026-09-05-00-backlog-arch4.md](2026-09-05-00-backlog-arch4.md)
依存: なし（他 6 件と独立）

## ユーザーストーリー
content script を保守する開発者として、VALID_VISIT ペイロードの構築と blocked/private/force-retry 政策が `VisitReporter` 1 モジュールに集約されてほしい。なぜなら同一形状が `VisitReporter.report` と `extractor.ts` の GET_CONTENT 応答（~168-201）で二重に組み立てられ、retry 時の項目抜け・dialog 未表示・二重送信の不具合が呼び出し側に潜むから。

## BDD受け入れシナリオ

```gherkin
Scenario: 自動記録と手動取得で同一ビルダーが使われる
  Given PageState と同一の抽出状態
  When  VisitReporter 経由と GET_CONTENT 応答を構築する
  Then  byte/stat 項目の選択が同一ビルダーから出る

Scenario: blocked/private/force-retry 行列が fake 駆動で検証できる
  Given sender・confirm dialog・label 参照の fake adapter
  When  各政策分岐を実行する
  Then  chrome なしに全行列が green になる

Scenario: force retry は意図的に最小のまま
  Given PRIVATE_PAGE_DETECTED 後の force retry
  When  送信ペイロードを検査する
  Then  `{content, force: true}` の最小形のまま（background は stats 全任意のため。変更禁止）
  And   初回・GET_CONTENT のフルビルダー間の項目選択は共有ビルダーから出る
```

## 受け入れ基準
- [x] `extractor.ts` の GET_CONTENT 応答組み立てが共有ビルダーへの委譲になる（~168-201 の項目選択重複が消える）
- [x] blocked/private/force-retry＋confirm＋sender 協調が `VisitReporter` 内に集約され、sender/dialog/label が注入 adapter になる
- [x] `pageState.ts` の `lastByteStats` / `lastAiSummaryCleansedStats` の読み手がビルダー経由になる
- [x] `contentKernel.ts` の `reportValidVisit` 配線が新 seam 越しになる
- [x] 既存 content suite が green。新規に政策行列テスト（fake 駆動）が追加される

## テスト戦略（t_wadaスタイル）
### 単体テスト
- ビルダーの項目選択テスト＋政策行列テスト（blocked/private/confirmed/declined）
### 統合テスト
- 既存 content テストは無修正で green（振る舞い不変）
### 例外ハンドリング
- dialog 失敗・sender 失敗・無効 PageState の経路

## 実装アプローチ
- **Outside-In**: 共有ビルダーのシグネチャ（PageState→payload）から設計 → GET_CONTENT 応答を委譲に → 政策分岐を adapter 注入で集約

## 見積もり
0.6w

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: sender＋dialog＋label を注入し、chrome なし駆動
- 非機能要件: ペイロード項目・送信順序・dialog 条件は不変。MV3 の `scheduler.yield` バッチ配慮（.kilorules §5）は維持
- dynamic dialog import の遅延性は維持すること（初期 load への影響禁止）

## 実装者向け注記

### 現状コードの確認
```bash
sed -n '160,205p' src/content/extractor.ts
rg -n "reportValidVisit|lastByteStats|lastAiSummaryCleansedStats" src/content/*.ts | grep -v __tests__ | head -20
```
2026-09-05 時点: visitReporter.ts 155 行、extractor.ts 205 行、pageState.ts 148 行。

### 実装手順
1. PageState→payload の共有ビルダーを VisitReporter 内に定義
2. GET_CONTENT 応答をビルダー委譲に（1 経路ずつテスト green）
3. blocked/private/force-retry 分岐を adapter 注入で集約
4. 政策行列テスト追加 → 全 green

### 落とし穴
- GET_CONTENT 応答と VALID_VISIT で項目集合が微妙に違う場合は、差分を引数化して潰さないこと（ビルダーに載せて明示化）
- `privacyDialog.ts` の dynamic import は維持（バンドル初期 load を太らせない）
- 二重送信防止のガードがあれば政策内に移し、呼び出し側の重複ガードは削除する（1 箇所化）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] content 全テスト green
- [x] コードレビュー完了
- [x] ドキュメント更新（content 抽出のペイロード契約があれば同期）
