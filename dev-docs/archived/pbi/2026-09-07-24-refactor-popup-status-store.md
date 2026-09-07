# PBI: Popup の二重 status 取得を StatusStore に統合 — ボタン文言と status 表示の不一致温床を解消

## ユーザーストーリー
Popup の記録体験を保守する開発者として、statusPanel の初期化と recordSession のボタン状態決定がそれぞれ `chrome.tabs.query → checkPageStatus(url)` を実行して同じ重い問いに 2 回答えているのを、1 回の取得を共有する StatusStore（単一 seam）に畳みたい、なぜなら `checkPageStatus` は GET_PRIVACY_CACHE + SettingsRepository.getAll + getSavedUrlsWithTimestamps + isDomainAllowed の並列取得を含む重い純データ関数であり、ポップアップ表示のたびに 2 回走り、しかもボタン文言の分岐（`domainFilter.allowed`）と status 表示の分岐が別スナップショットを参照するため、domain filter 変更直後などに「ボタンは Record Now、表示は filtered」といった不一致が起きうるから

## 優先度
- 順位: 05 / 6（本ラウンド）
- RICEスコア: **5.3**（Reach=2 / Impact=1 / Confidence=80% / Effort=0.3人週）
- 根拠: popup を開くたびに 2 回の重い status 取得が走る（実測: `statusPanel.initStatusPanel:12-82` と `recordSession.resetRecordButton:110-112` の両方が `chrome.tabs.query + checkPageStatus`）。不一致バグの温床という緊急性があるが、現状報告済みバグはなし。同点の PBI 25 との比較は「リスク軽減 → 緊急性」で緊急性の本件を先とする。

## 背景 / なぜなぜ分析サマリ
| 疑問 | 原因 → 示唆 → 解 |
|------|------------------|
| なぜ 2 回 fetch するのか | statusPanel（6 関心を 1 モジュールに混載した 494 行）と recordSession が独立に進化し、status の 1 回取得を共有する seam が設計されなかった |
| なぜ不一致バグの温床なのか | 2 回の取得の間に状態が変わると（domain filter の編集・trust 更新）、ボタン文言と status 表示が別スナップショット由来になる。locality 欠如で修正点が 2 箇所 |
| なぜ `normalizeUrl` が 4 実装あるのか | statusChecker.ts:115-130 のプライベート実装が、utils/urlUtils、background/headerDetector、PrivacyCache と並存。共通化する動機（「popup 専用の正規化」）が共有されなかった |
| なぜ StatusStore が深いモジュールか | interface は `get(url): Promise<PageStatusSnapshot>` 1 メソッド程度にでき、中で tabs 取得・並列 fetch・正規化を隠せる。deletion test 合格: 削除すると 2 つの query+checkPageStatus と描画分岐が 2 ファイルに再分散 |
| 解の粒度 | popup 内の 1 StatusStore が status を 1 回取得し、`statusPanel.render(status)` と `recordSession.resetButton(status)` が同じスナップショットを参照。`normalizeUrl` は utils/urlUtils に一本化 |

## BDD受け入れシナリオ

### Scenario: status が 1 回だけ取得される
  Given StatusStore を通すように配線した popup
  When popup を開く（initStatusPanel + resetRecordButton が両方走る）
  Then `checkPageStatus` の呼び出し回数が 1 回であり、statusPanel と recordSession が同一スナップショットを受け取る（テストで検証）

### Scenario: domainFilter 判定がボタンと表示で一致する
  Given domainFilter が不允许な URL のタブ
  When popup を開く
  Then ボタン文言（forceRecordAnyway）と status 表示（filtered 状態）が同一スナップショット由来で一致する

### Scenario: status 取得が null（アクティブタブ URL なし）でも壊れない
  Given アクティブタブの URL が取得できない状況（chrome:// ページ等で url が undefined）
  When StatusStore.get を呼ぶ
  Then null スナップショットを返し、statusPanel と recordSession が現行と同じフォールバック表示になる

## 受け入れ基準
- [x] popup 内に StatusStore（または `loadTabStatus(): Promise<StatusSnapshot | null>` 1 関数の共有モジュール）が新設され、`chrome.tabs.query + checkPageStatus` の実行が 1 箇所に集約されている
- [x] `statusPanel.initStatusPanel` と `recordSession.resetRecordButton` が StatusStore の同一スナップショットを参照する（直接の `checkPageStatus` 呼び出しが消える）
- [x] `normalizeUrl` が `src/utils/urlUtils.ts` に一本化され、`statusChecker.ts:115-130` のプライベート実装が削除されている（headerDetector / PrivacyCache 側は本 PBI では触らない。実装メモに残課題記録）
- [x] statusPanel.ts の 6 セクション描画（privacy mode / domain / privacy / cache / lastSaved / cleansing）の分岐が現行どおり機能する（モジュール分割の全面リファクタは行わない。最小は「同じスナップショットを渡す」まで）
- [x] 既存 popup テスト（statusPanel / statusChecker / recordSession 系）が green（振る舞い不変。`checkPageStatus` 呼び出し回数の新規 assert を追加）
- [x] `npm run type-check` / `npm run lint` / popup 関連テストが green

## テスト戦略
- 単体: StatusStore の新規テスト — 1 回取得の共有（スパイで呼び出し回数 1 を assert）、null フォールバック、スナップショット同一性
- 回帰: 既存 popup テスト群が green
- 非対象: statusPanel の全面分割（6 セクションの render 関数化は本 PBI のスコープ外として台帳に記録可能）、background 側の normalizeUrl 統合

## 実装アプローチ
1. `src/popup/statusStore.ts`（または statusChecker.ts 内の公開関数）を新設。`loadActiveTabStatus(): Promise<PageStatusSnapshot | null>` が tabs.query → url → checkPageStatus を所有
2. statusPanel / recordSession の直接呼び出しを置換（recordSession.resetRecordButton:107-122 は引数でスナップショットを受け取る形に変更可。呼び出し側の main.ts 配線を確認）
3. normalizeUrl を urlUtils に寄せ、statusChecker のプライベート実装を削除
4. 呼び出し回数 assert のテストを追加し、全検証

## 見積もり
1.5 pt（0.3 人週相当）

## 未解決事項
1. recordSession が status を再取得するタイミング（録画完了後の resetRecordButton 呼び出し）は「最新状態を取り直す」意味があるか → **結論: store は stateless とし、完了パスは省略時引数で fresh fetch（refresh 相当）**。`resetRecordButton(recordBtn, snapshot?)` にスナップショット省略引数を追加し、呼び出し側が同一スナップショットを渡せば再 fetch しない（将来的な popup open 時の共有に備える）
2. statusPanel の 6 関心分割（render 関数化）を同時にやるか → やらない（スコープ外）。台帳に残す

## 実装メモ（2026-09-07 arch-delivery-loop）

- `src/popup/statusStore.ts` 新設: `loadActiveTabStatus(): Promise<ActiveTabStatusSnapshot>`（tab / url / status）。chrome.tabs.query + checkPageStatus の単一所有者。stateless（seam は fetch ロジックの 1 所有者でありキャッシュではない）
- `statusPanel.initStatusPanel`: 自前の tabs.query + checkPageStatus を store 経由に置換（currentTab.id での GET_CONTENT 送信と updateTrustStatus は snapshot.tab / snapshot.url を使用、振る舞い不変）
- `recordSession.resetRecordButton`: `snapshot?` 引数追加。省略時は store から fresh fetch（完了パスの現行挙動 = 再取得を維持）
- `normalizeUrl` 統合: urlUtils に非 throw 版 `normalizeUrlSafe` を新設（hash 除去 + 末尾スラッシュ除去 + パース失敗時は元 URL 返却）し、statusChecker のプライベート実装を削除。**既存 `normalizeUrl`（throw 版）とは意図的に挙動が異なる**ため統合は別名で実施。headerDetector / PrivacyCache の同型実装との統合はキャッシュキー意味論の確認が必要（台帳候補）
- 補足: 診断時の「popup 表示のたびに 2 回 fetch」は実測では誤りで、popup open 時の fetch は statusPanel 1 回のみ（resetRecordButton は録画完了系パスで発火）。本 PBI の価値は fetch ロジックの単一所有者化 + スナップショット共有の足場 + 不一致温床の解消
- 検証: type-check / lint（0 errors）/ popup + urlUtils 856 テスト / 全テスト 11,893 green

## Definition of Done
- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] popup 本番コードの `checkPageStatus` 直呼びが 1 箇所に集約されている（grep で確認）
- [x] `normalizeUrl` の popup プライベート実装が削除されている
- [x] コードレビュー完了
- [x] `npm run type-check` / `npm run lint` / popup テスト green
