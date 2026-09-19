# PBI: クレンジングのサイズ超過を同期フォールバックに伝播させる

## ユーザーストーリー
拡張機能利用者として、巨大ページのクレンジングがメインスレッドを固めないでほしい、なぜならOffscreen拒否がコンテンツスクリプト側の同期パースに転送されるだけでは保護にならないから

## 優先度
- 順位: 01 / 7
- RICEスコア: 80（Reach=100 / Impact=2 / Confidence=80% / Effort=2）
- 根拠: レビュー最高の実害（main thread ブロッキングが残存）。Offscreen上限（PBI 01）の効果を無効化する抜け穴

## ビジネス価値
512KB上限が実際に main thread 保護として機能する。測定は拒否時の同期パース発生件数（0になること）

## BDD受け入れシナリオ

```gherkin
Scenario: サイズ超過はフォールバックせず原文を返す
  Given 512KB超の html が Offscreen で拒否される
  When cleanseViaOffscreen が拒否応答を受け取る
  Then 同期パースを実行せず元の html を返す
  And 拒否理由が too large 系であることを判定材料にする

Scenario: その他の失敗は従来通り同期フォールバックする
  Given Offscreen がサイズ以外の理由で失敗する
  When cleanseViaOffscreen が失敗応答を受け取る
  Then cleanseHtmlSync にフォールバックする
```

## 受け入れ基準
- [x] too large エラーを判別する判定（TOO_LARGE_ERROR_PREFIX 接頭辞）が実装されている
- [x] too large の場合は cleanseHtmlSync を呼ばない（元 html を返す）
- [x] サイズ以外の失敗は従来どおり cleanseHtmlSync にフォールバックする
- [x] 既存の cleansing テストが green である（13 passed）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 巨大ページで記録フローが固まらない

### 統合テスト
- delegate が too large 応答で同期パースをスキップすること

### 単体テスト
- エラー分類（too large / その他）の境界値

## 実装アプローチ
- **Outside-In**: delegate の分岐テストから開始
- **Red-Green-Refactor**: エラー分類を純粋関数化

## 見積もり
2ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: PBI 01（2026-09-19-01）の上限実装が前提
- テスタビリティ: 分類関数は純粋関数にする
- 非機能要件: 元 html を返す際は呼び出し側の挙動（そのまま記録される等）を確認すること

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "too large\|MAX_CLEANSING_HTML_BYTES" src/offscreen/cleansingOffscreen.ts
grep -n "cleanseHtmlSync" src/content/cleansingOffscreenDelegate.ts
```

### 実装手順
1. too large 判定の単体テストを書く
2. 拒否応答のエラーに機械可読な接頭辞（例: `TOO_LARGE:`）を付ける
3. delegate で接頭辞を検出したら同期パースをスキップする

### 落とし穴
- catch 経路（sendMessage 例外）はサイズ判定の対象外。同期フォールバックを維持すること
- 元 html を返すと生 html が下流に流れる。下流の想定を確認すること

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
