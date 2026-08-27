# PBI: SanitizePreview Presenter の抽出

## ユーザーストーリー
開発者として、`sanitizePreview.ts` の 443行 God ファイルを `MaskNavigator` / `PreviewView` / `PreviewPresenter` に分割したい、なぜならモジュールグローバルな可変状態 (`resolvePromise`/`maskedPositions`/`resizeObserver`) がテスト間で共有され、`showPreview` が DOM 操作とビジネスロジックとライフサイクルを6ステップで直結し、focus/ESC/resize のリグレッションが再現困難だから。

## 優先度
- 順位: 1 / 3
- RICEスコア: 213（Reach=40 / Impact=2 / Confidence=80% / Effort=0.30）
- 根拠: プライバシーゲート (UF-401) のユーザー可視部分で履歴的に focus/ESC/resize のリグレッションが多発。`MaskNavigator` の純粋化で jsdom 不要の単体テストが可能になり重複した i18n plural ロジックも解消。

## なぜなぜ分析
- なぜ God か: `getModal`/`getPreviewContent` (DOM取得) + `buildMaskStatusText`/`collectMaskedPositions` (ビジネス) + `jumpToMaskedPosition`/`buildMaskNavigation` (ナビ) + `initializeModalEvents`/`cleanupModalEvents` (ライフサイクル) が1ファイルに混在
- なぜテスト不能か: `document.getElementById` が8箇所で直呼びされ `doc: Document` の注入点がない。`resolvePromise` がモジュールグローバルで `showPreview` 連続呼び出しで上書きされ二重解決/ハング
- 解: `MaskNavigator` (純粋: `collectPositions(text)->MaskedPosition[]`, `next/prev` with wrap), `PreviewView` (interface `show(html)`, `onConfirm/onCancel`, inject `doc`), `PreviewPresenter` ( `resolvePromise` + `ResizeObserver` ポリシーを所有し委譲)

## BDD受け入れシナリオ
Scenario: ハッピーパス — マスク位置が正しく収集される
  Given `text` に3つのマスク位置がある
  When `MaskNavigator.collectPositions(text)` を呼ぶ
  Then 3件の `MaskedPosition` が返る

Scenario: エッジケース — 連続 showPreview で Promise がハングしない
  Given `showPreview` を2回連続で呼ぶ
  When 1回目の Promise が未解決のまま2回目を呼ぶ
  Then 1回目の Promise は拒否され、2回目の Promise が正しく解決する

## 受け入れ基準
- [ ] `MaskNavigator` が純粋関数として `collectPositions`/`next`/`prev` を提供する
- [ ] `PreviewView` が `doc: Document` を注入され `show`/`onConfirm`/`onCancel` の interface を持つ
- [ ] `PreviewPresenter` が `resolvePromise` と `ResizeObserver` を所有し、テストで `jest.resetModules()` が不要になる

## テスト戦略
- 単体: `MaskNavigator` の `collectPositions`/`next`/`prev` の純粋テスト (jsdom 不要)
- 単体: `PreviewView` の `show`/`onConfirm`/`onCancel` の `Document` モックテスト
- 統合: `PreviewPresenter` のライフサイクル (focus/ESC/resize) テスト
- E2E: `sanitizePreview` の表示/確定/キャンセル フロー

## 見積もり
2pt（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
