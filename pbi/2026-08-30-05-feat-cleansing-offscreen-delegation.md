# PBI: クレンジングの Offscreen Document 委譲でメインスレッド占有を削減する

## ユーザーストーリー

低スペック端末の閲覧者として、クレンジング中もページスクロールがカクつかないようにしたい。なぜなら現行 `cleanseAISummaryContent` は Content Script のメインスレッドで74回 `querySelectorAll` と `Blob` 生成を実行し、長文ページで数十msのブロッキングが発生しうるから。

## 優先度

- 順位: 05 / 14
- RICE: Reach 4 / Impact 2 / Confidence 0.5 / Effort 5日 = 0.8
- 根拠: 効果は体感しづらく、Offscreen Document のライフサイクル制約(30秒で破棄)やメッセージング往復の複雑さがEffortを押し上げる。PBI-04の計測結果で効果が裏付けられた場合に優先度を上げる。

## 背景

- 現行: `contentKernel.ts` → `pageContentPipeline.ts` → `contentExtractor/index.ts` → `aiSummaryCleaner/index.ts` が Content Script 内で同期実行。`cloneNode(true)` でDOM複製 + `Blob` でバイト数計測。
- 課題: Content Script はページのメインスレッドと同一。長いDOMでブロッキングするとスクロール/入力が遅延。
- 機会: `src/offscreen/offscreen.ts` は既にDOM操作を担っている。クレンジングの clone + strip 処理を Offscreen に委譲し、Content Script は `chrome.runtime.sendMessage` で結果のみ受け取る形にできる。Offscreen は `DOMParser` / `document` を持つため `querySelectorAll` 実行可能。
- 制約: Offscreen Document は `chrome.*` API の大半が使えないが、クレンジングは純粋なDOM操作なので問題なし。Service Worker 経由のメッセージングが必要。

## BDD 受け入れシナリオ

```gherkin
Scenario: Offscreenでクレンジングが実行される
  Given 長文DOM(5000要素)がある
  And Offscreen Document が生成されている
  When Content Script が Offscreen にクレンジングを依頼する
  Then Offscreen で cleanseAISummaryContent が実行され、結果が Content Script に返る

Scenario: Offscreenが利用不可ならフォールバックする
  Given Offscreen Document が生成できない環境である
  When クレンジングを依頼する
  Then Content Script 内で従来通り同期実行される

Scenario: 従来の削除結果と一致する
  Given 同一DOMと同一configがある
  When Offscreen委譲版と従来版をそれぞれ実行する
  Then AiSummaryCleanseResult.totalRemoved と bytesBefore/After が一致する
```

## 受け入れ基準

- [ ] `src/offscreen/offscreen.ts` にクレンジング実行ハンドラが追加される
- [ ] `src/content/contentKernel.ts` または `src/utils/pageContentPipeline.ts` が Offscreen 委譲を試み、失敗時にフォールバックする
- [ ] Offscreen 委譲時と従来同期実行時で削除結果が一致することをテストで保証
- [ ] Offscreen Document のライフサイクル(生成/破棄/再生成)が考慮され、`chrome.offscreen.hasDocument` チェックがある
- [ ] `npm run validate` が通る

## テスト戦略

### E2E
- 手動: 長文ページでクレンジング前後のスクロール滑らかさを DevTools Performance で計測

### 統合
- `offscreen.test.ts` にクレンジング委譲の統合テスト。`chrome.runtime.sendMessage` をモックし、Offscreen ハンドラを直接呼び出し

### 単体
- Offscreen ハンドラの単体テスト: 同一DOMで同期版と結果一致
- フォールバックパスの単体テスト: Offscreen 不在時に同期実行される
- メッセージングのタイムアウト/エラーハンドリングテスト

## 実装アプローチ

- **Outside-In**: Offscreen ハンドラの統合テストを先に書く → `offscreen.ts` にハンドラ実装 → `contentKernel.ts` に委譲ロジック追加 → フォールバックテスト
- **段階移行**: まずは `cleanseAISummaryContent` のみを委譲。`contentCleaner.ts` (Content Cleansing) は対象外。成功したら `pageContentPipeline.ts` 全体を委譲対象に拡大

## 見積もり

5pt (Offscreenライフサイクル調査2 + 実装2 + テスト1)

## 技術的考慮事項

- 依存: PBI-04の計測結果。効果が小さければ本PBIは見送り可能
- テスタビリティ: Offscreen Document は jsdom で再現不可。`chrome.offscreen` のモックと、DOM操作部分の分離が必要
- 非機能: メッセージング往復によるレイテンシ増。DOMのシリアライズ( `outerHTML` )コストとトレードオフ
- セキュリティ: Offscreen に渡すDOMは `outerHTML` 文字列。XSSリスクはないが、サイズ上限に注意

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "offscreen" src/ --include="*.ts" | head -n 20
grep -rn "chrome.offscreen" src/
cat src/offscreen/offscreen.ts | head -n 100
```

### 実装手順
1. `src/offscreen/offscreen.ts` に `CLEANSE_AI_SUMMARY` メッセージハンドラを追加。`DOMParser` でDOM復元→ `cleanseAISummaryContent` 実行→結果を返却
2. `src/content/contentKernel.ts` に `tryOffscreenCleanse` を追加。`chrome.offscreen.hasDocument` → `sendMessage` → タイムアウト時は同期フォールバック
3. 統合テストで結果一致を検証

### 落とし穴
- Offscreen Document は `chrome.offscreen.createDocument` が Manifest V3 でのみ有効。Firefox非対応
- `cloneNode(true)` の Shadow DOM 非対応問題と同様、Offscreen への `outerHTML` 渡しでも Shadow DOM は失われる
- Offscreen Document は30秒非アクティブで破棄される。毎回生成するとオーバーヘッドが大きいため、既存の Offscreen 再利用を検討

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ドキュメント更新済み
