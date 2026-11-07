# PBI 2026-11-08-04: connectionTests innerHTML 往復の除去

## メタ情報

- ラウンド: arch-delivery-loop archloop-1108
- 順位: 4/9
- RICE: 6.4 (R4 / I2 / C0.8)
- 依存: なし
- 種別: fix
- 規模: S
- プライバシー: host・port・エラー文を扱う表示面。外部送信の追加なし。escape 強化のみ
- 振る舞い変更: 見た目不変 (描画順序のみ整理)

## ユーザーストーリー

利用者として、接続テストの結果表示を XSS-safe に保ってほしい。なぜなら host・エラー文など外部由来文字列が混ざる面で innerHTML 往復が escape 保証を切っているから。

## 背景 (Read確認済み)

- `src/dashboard/generalSettings/connectionTests.ts:364-366`: `statusDiv.innerHTML` 保存→`showStatus`→復元。
- 同 `:432-434`: `target.innerHTML` で同型の往復。
- 当該ファイルは `:344-350` で createElement+textContent 組立ながら仕上げで往復。他面 (`tagChip.ts:10`, `diagnosticUtils.ts:12`, `PanelNotices.ts:36`) は innerHTML 不使用を明記。popup 本番の innerHTML 代入はゼロ、dashboard 本番もこの2箇所のみ。
- 規定: escape は `src/utils/htmlEscape.ts` の escapeHtml が canonical、クリアは `src/utils/domClear.ts` の clearElement。
- `src/dashboard/statusView.ts:19` 前後: rich HTML 所有の言及あり。rich 所有者を1箇所に限定する方向。

## BDD受け入れシナリオ

```gherkin
Scenario: innerHTML 往復なしで装飾が残る
  Given 接続テストが結果を描画する
  When showStatus が文言を更新する
  Then 事前の rich ノードが壊れない
  And innerHTML の読み書きが発生しない
```

```gherkin
Scenario: 外部由来文字列が escape される
  Given host・port・エラー文に markup が混ざる
  When 結果が描画される
  Then textContent 経由でのみ描画される
  And check-innerhtml-escape ゲートが緑である
```

## 受け入れ基準

- [x] 2箇所の innerHTML 往復が除去される (cloneNode/DocumentFragment 保存か showStatus 側の seam 整理のいずれか)
- [x] 見た目の回帰なし。既存テスト緑 + `check-innerhtml-escape` 緑
- [x] 新規テスト: markup 混じり host でも script 実行されない pin が1件以上ある

## テスト戦略

- 単体: `src/dashboard/generalSettings/__tests__/` に markup pin を追加。実時間待ちなし。
- E2E追加なし。
- 手動 (DoD分離): 実機の接続テスト表示目視は owner 手順に残す。

## 5 Whys記録先

- `/tmp/whywhy/2026-11-08-04-innerhtml.md`
