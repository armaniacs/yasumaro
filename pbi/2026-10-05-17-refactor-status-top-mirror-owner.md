# PBI: `#status` → `#statusTop` のミラーが「呼び出し側が毎回呼ぶ」契約で、9 箇所が欠落している

## ユーザーストーリー

設定画面の利用者として、sticky な上部バーの更新を呼び出し側の記憶から解放したい。`syncStatusToTop()` を忘れた書き込みは下部だけ更新されたまま上部が古いメッセージを指し続け、ミラーの向きと適用範囲がコードから復元できないから。

## 優先度

- 順位: 13/32
- RICE: 5.0（R5 / I1 / C1.0 / E1）
- 根拠: 純 RICE では上位だが `connectionTests.ts` を NN11 と共有するため NN11 の後に実行する（逸脱 1）
- 依存: NN11（status 書き込みを 1 本化した後に移設先が決まる）

## 背景（file:line 現状）

- `src/dashboard/statusView.ts:16-18`: コメントが「copy は one-shot。呼び出し側が status 更新のたびに再呼出しする必要がある」と自認。`:20-27` の `syncStatusToTop`、`:29-32` の status バインディング未登録（誰も経路を使っていない旨をコメント明記）
- `src/utils/ui/settingsUiHelper.ts:60-82` の `showStatus` は mirror しない
- 呼ぶ側（10 箇所）: `src/dashboard/settingsPipeline.ts:186`、`src/dashboard/generalSettings/connectionTests.ts:50, :256, :323, :327, :370, :371, :393, :398`、`src/dashboard/generalSettings/providerPresets.ts:32`
- 呼ばない側（`#status` 書き込み 9 箇所）: `src/dashboard/masterPassword.ts:224, :229, :236, :247, :249, :251, :253, :255, :398`（`syncStatusToTop` の出現 0 件を grep 確認済み）
- 逆方向の直書き（`#statusTop` のみ・`#status` 不更新）: `connectionTests.ts:406-411, :431-432, :462-463, :472-473, :421`（NN11 で統合対象）
- 影響: パスワード認証の成功/失敗が上部 sticky バーに反映されない

## BDD受け入れシナリオ

```gherkin
Scenario: masterPassword の表示が上部バーに反映される
  Given masterPassword のいずれかの showStatus 呼び出し
  When 実行する
  Then #status と #statusTop の両方が更新される

Scenario: 呼び出し側が mirror を覚えなくてよい
  Given 新規の showStatus('status', ...) 呼び出し
  When 追加する
  Then syncStatusToTop の手呼び出しなしで両方が更新される

Scenario: 二重 mirror でも挙動が変わらない
  Given 移行期の手呼び出しが残った箇所
  When 実行する
  Then mirror が冪等で表示が変わらない
```

## 受け入れ基準

- [x] mirror が `showStatus` 側の関心に戻っている（対象が `#status` のときだけ `syncStatusToTop()`）
- [x] 上記 10 箇所の手呼び出しと `showSaveError` の `syncTop` オプション（`connectionTests.ts:47, :50`）が削除されている
- [x] null ガード（`statusDiv` / `statusTopDiv` の両方見て return）と `setElementHtml` による innerHTML コピーはそのまま移設されている
- [x] NN11 の `connectionTests.ts` 変更と競合しない形になっている
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: `showStatus('status', ...)` 呼び出しで両要素が更新されるテスト
- 単体: 片方欠落時の null ガードテスト
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

1 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/utils/ui/settingsUiHelper.ts`（`showStatus` 内で対象が `#status` のときだけ mirror。`syncStatusToTop` の実装自体も同ファイルへ移動）、`src/dashboard/statusView.ts`（再エクスポート化）、`src/dashboard/settingsPipeline.ts` と `src/dashboard/generalSettings/providerPresets.ts`（手呼び出し削除）、`src/dashboard/generalSettings/connectionTests.ts`（`showSaveError` の手呼び出し削除。`#status` への直接 DOM 書き込みに付随する明示 sync は残す — `showStatus(text)` では node を運べないため。mirror は冪等で挙動不変）
- 逸脱の記録: 受け入れ基準の「10 箇所の手呼び出し削除」は直接 DOM 書き込みに付随する分は残した（showStatus 経由化は別 PBI の範囲）。表示結果は同一
- 統合修正: 当初 settingsUiHelper が dashboard/statusView を import してレイヤ境界違反（utils→dashboard の逆依存）で lint エラーになったため、実装を settingsUiHelper 側へ移し statusView から再エクスポートする形に統合側で修正
- テスト: mirror 3 件追加。対象 159 tests green
- ゲート: type-check PASS / lint 0 errors
