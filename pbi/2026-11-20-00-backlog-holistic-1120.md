# 台帳: 大局的改善ラウンド holistic-1120

2026-11-20 の holistic-code-review 報告書(改善テーマ TOP 4)を受けた実装ラウンドの台帳。
レビュー出所: holistic-code-review による `yasumaro` 全体レビュー(観点: DRY / SoC / 拡張性 / 堅牢性)。
積み残しテーマはなし(報告書セクション4は空)。

## RICE 採点(同一基準・同一前提)

非機能改善の目安で採点。Reach は今後1年の保守関与頻度(相対 1-10)。
Impact は 3=実害解消 / 2=大きい / 1=中 / 0.5=小。Confidence は 1.0=コードで確定 /
0.8=設計判断が残る。Effort は SP。

| 順位 | 候補 | Reach | Impact | Confidence | Effort(SP) | RICE | 種別 | PBI |
|---|---|---:|---|---|---:|---:|---|---|
| 1 | tab問い合わせ複製の解消とタイマ一元化 | 8 | 2 | 1.0 | 1 | **16.0** | refactor | [2026-11-20-01](2026-11-20-01-refactor-tab-fetch-unify.md) |
| 2 | 符号化所有の固定と順序回帰試験 | 6 | 2 | 0.8 | 2 | **4.8** | refactor | [2026-11-20-02](2026-11-20-02-refactor-sanitize-ownership.md) |
| 3 | PrivacyPipeline の純粋部切り出し | 8 | 2 | 0.8 | 3 | **4.3** | refactor | [2026-11-20-03](2026-11-20-03-refactor-privacy-pipeline-split.md) |
| 4 | dashboard gateway の共通 seam 利用者化 | 5 | 1 | 0.8 | 2 | **2.0** | refactor | [2026-11-20-04](2026-11-20-04-refactor-dashboard-gateway-seam.md) |

## 実行順と逸脱理由

実行順は RICE 降順(01 → 02 → 03 → 04)。依存による並べ替えはなし。
4 件の触るファイル群は互いに重ならず、解が互いの前提にならないため、
フェーズEでは同一バッチで並列実行する。

## 依存マップ

- 01 → なし(`src/popup/contentFetchGateway.ts` + `src/messaging/withRuntimeTimeout.ts` の利用のみ)
- 02 → なし(`src/utils/htmlEscape.ts` / `markdownSanitizer.ts` / `promptSanitizer.ts`)
- 03 → なし(`src/background/privacyPipeline.ts` + `src/utils/llmOutputGuard.ts` の参照のみ)
- 04 → なし(`src/messaging/gatewayFactory.ts` / `dashboardGateway.ts` / `sendWithPolicy.ts`)

## 台帳送り(再検討トリガー付き)

なし。レビュー報告書に積み残しはなく、4 テーマ全件を本ラウンドで PBI 化した。
継続 PBI(`omnibox-url-fallback` 未着手、`release-store-upload-failure` 検証待ち、
`ai-model-review` 四半期継続)は本ラウンドの対象外とし、各 PBI の既定の扱いに委ねる。

## 検証コマンド(フェーズ0確定値)

- 型検査: `npm run type-check`
- lint: `npm run lint`
- テスト: `npm run test`(フルスイート)、ゲート: `npm run validate`
- ビルド: `npm run build`
