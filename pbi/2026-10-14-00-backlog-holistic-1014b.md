# 2026-10-14 holistic-code-review ラウンド バックログ台帳（holistic-1014b）

## 出所

- holistic-code-review skill による大局的レビュー（コードベース全体の構造的観点）。
- 調査方法: architecture map読解＋幅優先の代表モジュール実読＋4観点の並列サブエージェント調査（DRY／SoC／拡張性／堅牢性、各々が実在file:line付きで報告、未読は「要確認」明示）＋統合側の裏取り実読。
- レビュー報告書: 本チャット内の「大局的コードレビュー」報告（サマリー3強み＋テーマTOP 5）がSSOT。本台帳はRICE採点・順位根拠・依存・バッチ計画のSSOT。
- NN01–NN05 に起票。ファイル名のNNが着手順。

## RICE 採点表（RICE 降順）

RICE = R × I × C / E。Reach 5=毎回の記録・毎PR／3=週次的／2=追加時のみ。Impact 3=実害解消／2=大／1=中／0.5=小。Confidence 1.0=実読確定／0.8=設計判断残る。Effortは人週相当。

| 順 | NN | PBI | 種別 | R | I | C | E | RICE |
|---|---|---|---|---|---|---|---|---:|
| 1 | 01 | [2026-10-14-01-fix-robustness-two-layer-errors-locks-logs.md](2026-10-14-01-fix-robustness-two-layer-errors-locks-logs.md) | fix | 5 | 2 | 1.0 | 1.0 | 10.0 |
| 2 | 02 | [2026-10-14-02-refactor-gateway-send-policy-seam.md](2026-10-14-02-refactor-gateway-send-policy-seam.md) | refactor | 5 | 1 | 1.0 | 0.5 | 10.0 |
| 3 | 03 | [2026-10-14-03-refactor-popup-domain-separation.md](2026-10-14-03-refactor-popup-domain-separation.md) | refactor | 5 | 2 | 0.8 | 1.5 | 5.3 |
| 4 | 04 | [2026-10-14-04-refactor-sqlite-search-statement-twins.md](2026-10-14-04-refactor-sqlite-search-statement-twins.md) | refactor | 3 | 2 | 0.8 | 2.0 | 2.4 |
| 5 | 05 | [2026-10-14-05-refactor-sync-target-yagni-cleanup.md](2026-10-14-05-refactor-sync-target-yagni-cleanup.md) | refactor | 2 | 0.5 | 1.0 | 0.5 | 2.0 |

## 同点の順位根拠（tie-break）

- **10.0（01 と 02）**: NN01先行 — リスク軽減効果。黙って消える失敗の可視化が契約drift防止より先行する。

## 純 RICE 順からの逸脱

なし（実行順はRICE順どおり。ファイル重複による直列化のみ下記）。

## 依存マップ（実行順の制約）

- NN01とNN03は同一ファイルに触る（`manualContentFetcher.ts` のcatch可視化 vs ports注入、`sqliteHistoryModel.ts` のログ寄せ vs 注入fallback）→ **NN01 → NN03の順で直列**（hunk分離。NN01がログを寄せ、NN03がコードを動かしてログを同伴させる）。
- その他の組み合わせに同一ファイル重複なし（NN02は `*Gateway.ts`＋`withRuntimeTimeout` 隣、NN04は `offscreen/queryPlan*`＋`sqliteQueryBuilder`、NN05は `syncTargets/`＋`providerCatalog`＋providers）。

## バッチ計画（W1 並列 → W2 直列）

| Wave | NN | 内容 |
|---|---|---|
| W1 | 01 ／ 02 ／ 04 ／ 05 | ファイル非重複のためサブエージェント4体で並列実行可 |
| W2 | 03 | NN01完了後に実行（同一ファイルの順序依存） |

## なぜなぜ分析（疑問の自律解決）

- D1「confirmTokenの単回性」— なぜ問題か：save失敗時に削除が永続化されず再利用窓が開く → 解：NN01の受け入れ基準にpersist失敗テストをpinし決着させる。
- D2「KEK base64残存」— なぜ別扱いか：鍵設計変更は高難易度で本ラウンドの枠を超える → 解：NN01対象外とし、本台帳にフォローアップとして残す。
- D3「Obsidian未乗せ」— なぜ今決めないか：シグネチャ不整合の解消は保存先戦略の判断を要する → 解：NN05でexperimental明記＋判断分離し、挙動は変えない。

## フォローアップ（台帳送り）

- F1: KEK base64のsession／local残存の脅威モデル判断と鍵設計（`hmacKeyStore.ts`）。将来のsecurityラウンドで扱う。
- F2: `dashboardGateway.ts:148-188` リトライループの `sendWithPolicy` への寄せ（3つ目のretrying opが出たら再評価）。
- F3: UI残存 `console` のうち情報系（`trancoNotification.ts` のlog／warn、`tagCooccurrenceTablePanel` 等の非エラー系）の寄せ残し、uBlock import内部分散の精査（DRY報告の要確認2件）。
- F4: 旧PBI `2026-09-22-01-backlog-empty-catch-audit`（⬜未着手・トリガーゲート）の再評価。本ラウンドNN01が空catch 10箇所以上を可視化済みのため、当該PBIの対象6箇所が吸収されている可能性が高い。NN01完了後に差分照合し、重複ならsupersededとしてアーカイブすること。

## 実行結果

- W1（01／02／04／05）を並列実行（01は統合側が実装、02／04／05はサブエージェント3体が所有ファイル分離で並列、未コミットで報告→統合側が検証・マージ）。W2（03）を統合側がNN01完了後に実装。
- 実装コミットは `1afa7b25`（01）/ `e7918862`（02）/ `f23e91e3`（04）/ `09833ffa`（05）/ `a07bcc19`（03）。全5件、受入基準のうち実測で対応済み・許容と判断した項目はWHY記録の上で変更なし（01: aiUsageTracker等の素get/set、意図的沈黙4箇所、trustPanel。03: PII分岐・ゲート・dashboard直結）。
- 5 Whysは各実装のレポートに記録（サブエージェント報告＋統合側のNN01／NN03判断）。
- W1マージ検証: `tsc` 0 errors、eslint 0 errors、`src/messaging` 428件、`src/offscreen` 1254件、`src/background/ai`＋token 396件、`src/dashboard/panels`（DashboardBootstrapper修正後は21件緑）、`background/cache＋popup` 972件、`settingsMigration＋staticForm` 123件。NN03追加検証: 40 files / 478 tests passed。
- ダッシュボードの6件失敗（`console.error` pinテスト）はseam移管に伴うテストcodemodで解消（失敗側の検出力を維持）。
