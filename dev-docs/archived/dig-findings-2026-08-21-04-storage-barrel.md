# なぜなぜ分析 — storage-barrel-retire

## 現象
`src/utils/storage.ts`（@deprecated barrel、38 re-export）が production 75箇所 + テスト90ファイルから参照され、lint の no-restricted-imports 警告58件が残存。Wave 3 移行が停滞していた。

## 5 Whys
1. なぜ 75箇所も barrel import が残っているのか → 直接 import への置換が機械的作業のため後回しにされ、lint も警告止まり（エラーではない）で強制力がなかったため
2. なぜ lint をエラーにしなかったのか → 参照が0になる前にエラー化すると CI が落ちるため、warning 運用で暫定放置されていたため
3. なぜテストが barrel を mock し続けていたのか → `vi.mock('storage.js')` は1箇所で全シンボルを差し替えられる便利ハーネスであり、所有モジュールごとの mock 分割が明示的な手順として存在しなかったため
4. なぜ mock 分割が必要になったのか → production が直接 import に移行すると、barrel への mock はモジュール解決グラフ上の別 ID を指すため、消費者に届かなくなるため
5. なぜ namespace 経由の代入・部分 StorageKeys 上書きが壊れたのか → automock の可変オブジェクトと re-export shim の getter-only 束縛、および部分オーバーライドと実値の混在という、mock 展開時に顕在化する暗黙契約がテスト側に潜んでいたため

→ 解: (1) codemod で production の静的75件+動的1件を所有モジュールの直接 import に一括置換、(2) テストは barrel mock をサブモジュール mock へ展開し、`importOriginal` スプレッド＋1階層ディープマージで実値を基底保持、(3) namespace 代入パターンは使用メンバー別の名前空間へ分割、(4) `.ts` 拡張子系3ファイルと文形式 factory 2ファイルは手動修復、(5) LAYERS.md を retired に更新。
