# PBI: docs/SSOT 照合ゲートが validate と CI に未配線（PRIVACY byte 同一を含む）

## ユーザーストーリー

保守担当者として、SSOT とドキュメントの照合スクリプトを `npm run validate` と CI に載せたい。現状はスクリプトが存在するのにどの自動ゲートにも載っておらず、ドキュメント単独編集の PR では drift が一切検知されないから。

## 優先度

- 順位: 1/32
- RICE: 12.0（R6 / I2 / C1.0 / E1）
- 根拠: PR 毎に validate を回すのに照合ゲートが載っていない。PRIVACY byte 同一は AGENTS.md で critical と明記されているのに自動検知されない
- 依存: なし

## 背景（file:line 現状）

- `package.json:44` の `validate` は `validate:json && lint && check-innerhtml-escape && check-deprecated-aliases && type-check && type-check:test:baseline && test` のみ
- `lint:layers-docs`（package.json:39）と `lint:adr-links`（package.json:40）は validate に含まれない
- `check-privacy`（`scripts/release-checks/check-privacy.mjs:32-42`、`public/PRIVACY.md` と `docs/PRIVACY.md` の byte 一致）は `release:check`（package.json:67）と `dev-docs/Makefile:117` の手動呼び出しのみ
- `.github/workflows/ci.yml:50-54` の path filter が `!**/*.md` と `!docs/**` のため、ドキュメント単独変更の PR では validate job 自体が skipped になる。`:127-155` の validate job steps にも layers / adr / privacy は無い
- 規約の出典: `dev-docs/LAYERS.md:204-217`、`AGENTS.md`（PRIVACY 同一）
- 補足（本 PBI 内で裁定）: `build:docs-i18n`（package.json:10）は `scripts/translation-key-map.json` が `{"ja":{},"en":{}}` の空マッピング（`docs/TRANSLATION_SYNC.md:7`）で実質 no-op

## BDD受け入れシナリオ

```gherkin
Scenario: validate が SSOT 照合ゲートを含む
  Given LAYERS.md の分類表と rule の layer リストに乖離がある
  When npm run validate を実行する
  Then lint:layers-docs が失敗し validate 全体が非ゼロ終了する

Scenario: PRIVACY の byte 乖離が検知される
  Given public/PRIVACY.md と docs/PRIVACY.md の内容が 1 バイトでも違う
  When npm run validate を実行する
  Then check-privacy が失敗する

Scenario: docs-i18n 機構の去就が裁定される
  Given translation-key-map.json が空マッピングのままである
  When 本 PBI の実装を行う
  Then マップを埋めるか機構ごと削除するかの裁定が PBI の実装記録に残り、残した側が validate で実行される
```

## 受け入れ基準

- [x] `npm run validate` が `lint:layers-docs` / `lint:adr-links` / `check-privacy` を含む
- [x] CI の validate job に同じ 3 step が追加されている（いずれも数 ms の Node 標準のみスクリプト）
- [x] path filter の `.md` / `docs` 除外は維持してよい（gate 自体が .md を読むため）。除外維持の場合はその理由が CI コメントまたは本 PBI の実装記録に残る
- [x] `build:docs-i18n` 相当の扱いが裁定済み（マップを埋める／機構ごと削除のいずれか）
- [ ] 追加後の `npm run validate` が green（最終ゲートで確認）

## テスト戦略

- 統合: `npm run validate` の通過（gate 自体がテスト）。意図的な drift を一時投入して gate が赤になることを確認し、投入分は revert する
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

1 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- `package.json` の `validate` に `lint:layers-docs` / `lint:adr-links` / `check-privacy` を追加、CI validate job に同一 3 step を追加。path filter の `.md` / `docs` 除外は維持（gate 自体が .md を読むため問題なし）
- docs-i18n 裁定: 維持。`translation-key-map.json` は空で no-op として安全、docs 固有キーは `docs/index.html` で直接管理する方針が `docs/TRANSLATION_SYNC.md` に明記済み。マッピング追加時に再評価
- ゲート: `lint:layers-docs` 59 entries in sync / `lint:adr-links` exit 0 / `check-privacy` PASS / `npm run lint` 0 errors
