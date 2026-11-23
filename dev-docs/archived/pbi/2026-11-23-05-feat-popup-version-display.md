# PBI: popupロゴ直下の動作中バージョン表示

## ユーザーストーリー
拡張利用者として、popupを開いただけで動作中のバージョンを見たい、なぜなら問い合わせや不具合報告の際に版を正確に伝えられるから

## ビジネス価値
- 問い合わせ対応の初動が速くなる。利用者が版を読み上げるだけで再現条件が絞れる
- 測定方法: popup表示から版確認までの操作数が0(開くだけ)になること。誤った版申告の減少

## 既実装確認 (フェーズ0結果)
- `grep -rn version src/` と `getManifest` 検索を実施済み
- popupヘッダー(`entrypoints/popup/index.html` `.header`)に版表示は未実装
- 版取得の既存例は診断系のみ(`src/dashboard/panels/diagnostic/DiagnosticsCollector.ts`、`archiveLifecyclePanel.ts` で `chrome.runtime.getManifest().version`)
- 本PBIは新規機能として扱う

## BDD受け入れシナリオ

```gherkin
Scenario: popupを開いたらロゴ直下に版が見える
  Given 拡張が正常に読み込まれている
  When 利用者がツールバーのYasumaroを開く
  Then ロゴ直下に動作中バージョン(例: v6.9.45)が小さく表示される

Scenario: 版が取得できない場合もpopupは壊れない
  Given 何らかの理由で版取得が失敗する
  When 利用者がpopupを開く
  Then 版表示は unknown 等の代替表示になり popupの他機能は使える
```

## 受け入れ基準
- [x] popupを開いただけで `.header` 内ロゴ直下に版が読める
- [x] 表示値は `chrome.runtime.getManifest().version` と一致する
- [x] 版取得失敗時は代替表示になり例外で起動が止まらない
- [x] 日本語と英語で表示が崩れない (i18n対応)
- [x] popupの既存レイアウトを崩さない (小さく控えめな表示)

## テスト戦略(t_wadaスタイル)

### E2Eテスト
- popupを開いて版表示がロゴ直下に見えること(ハッピーパス)

### 統合テスト
- `getManifest().version` から表示要素への結合。表示形式 `vX.Y.Z` の契約
- 他画面(options/dashboard)へ同一部品を適用する場合の表示確認

### 単体テスト
- 版文字列の整形ロジック (先頭 `v` 付与、空文字やnull時の `unknown` 化)
- 版取得失敗時の例外処理
- i18nキーが未定義でも代替文で落ちないこと

## 実装アプローチ
- **Outside-In**: E2Eテスト(失敗)→統合テスト(失敗)→単体テスト(失敗)→実装→グリーン→リファクタリング
- **Red-Green-Refactor**: TDDサイクルを各レイヤーで適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり
1ポイント (要チームでの見積もり)

## 技術的考慮事項
- 依存関係: なし。`chrome.runtime.getManifest()` は同期でCSP問題なし
- テスタビリティ: `getManifest` を注入可能にして単体試験で差し替え。E2Eでは実manifest値と照合
- 非機能要件: popup起動時間への影響は無視できる範囲にすること。表示は装飾目的のため読み上げは簡潔に(`aria-label` 等)
- 対象範囲: 主対象はpopup。options/dashboardへの適用は同一表示部品の再利用とし、別画面固有の作り込みはしない

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
grep -rn "getManifest" src/ entrypoints/
grep -rn "appTitle" src/utils/i18n* public/_locales/
```

### 実装手順
1. `entrypoints/popup/index.html` の `.header` 内、`h2[data-i18n="appTitle"]` の直下に `<span id="appVersion" class="app-version" aria-live="off"></span>` を追加する
2. 表示処理を `src/popup/` に小さな関数として作る (例: `initAppVersion(doc=getDocument, getManifest=... )`)。`chrome.runtime.getManifest().version` を読み `v` を付けて設定する。失敗時は `unknown` とする
3. `entrypoints/popup/main.ts` の `bootstrap()` から呼び出す。`applyI18n()` の後に呼ぶと上書きされない
4. `entrypoints/popup/styles.css` に `.app-version` を追加する。小さく控えめに (例: 11px、二次色)。ロゴ直下に収まるよう行間を詰める
5. `_locales` の案内文が要る場合は `appVersionLabel` 等を追加し `applyI18n` に対応させる。版数値自体は翻訳しない
6. 他画面(options/dashboard)は同関数か同CSSを再利用する。新規分岐は作らない

### 落とし穴
- `getManifest()` は例外を投げる場合がある。try-catchなしで呼ぶとpopup全体が止まる。診断系(`DiagnosticsCollector.ts:167`)と同様に代替値を返すこと
- `applyI18n()` が要素を書き換える順序に注意。版数値の書き込みはi18n適用の後に行うこと
- popup幅は狭い。長い版文字列でも折り返さないよう `white-space: nowrap` 等で抑えること
- テスト時は `chrome.runtime.getManifest` を直接触らず注入引数で差し替えること。直接参照は並列試験で干渉する

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす(E2E/統合/単体すべて)
- [ ] コードレビュー完了(GitHub PR での approve を必須とする。セキュリティに関わる変更は CLAUDE.md「For Security Review Agents」節の観点確認をPR説明に明記)
- [x] リファクタリング完了(グリーン後)
- [x] ロールバック手段の検討(挙動変更・性能変更・フィルタロジック変更・閾値変更等の場合、本番投入後に問題が発覚した場合の切り戻し手段を技術的考慮事項または本項に記載)
- [x] ドキュメント更新済み
