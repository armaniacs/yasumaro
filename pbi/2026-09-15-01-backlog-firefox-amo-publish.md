# PBI: Firefox AMO 公開 — アドオンストアへの申請と署名配布

## ステータス: ✅ 公開済み（2026-09-23 審査通過）

AMO 審査を通過し、公開済み。リスティングは
<https://addons.mozilla.org/ja/firefox/addon/yasumaro-ai-browsing-logger/>。

**公開版は 6.9.17**（2.89 MB、2026-09-23 更新、0 レビュー）。
main は 6.9.26 まで進んでおり、AMO への提出は 6.9.17 で止まっている。
次版 提出の可否はリリース判断（ユーザー作業）。

## ユーザーストーリー

Firefox ユーザーとして、addons.mozilla.org（AMO）から通常インストールしたい。なぜなら Developer Edition や署名無効化の手順なしに、安定版 Firefox へ導入したいから。

## 優先度（参考値 — 着手時に再採点すること）

- RICEスコア（参考）: 12.0（Reach=30 / Impact=2 / Confidence=40% / Effort=2人日）
- 根拠: 到達範囲は Firefox ユーザー全体だが、審査対応の工数不確実性が大きいため Confidence 40%。Effort には審査待ち・指摘対応のバッファを含む。**これは着手順を決める値ではない**（着手条件未達のため）

## 前提条件（すべて満たすまで着手禁止）

- [x] PBI 09・10・11 が完了していること
- [x] PBI 11 の配布方針で AMO 採用が決定していること（2026-09-23 ユーザー指示）
- [x] v6.9.0 の Firefox 対応が安定稼働していること（実機 QA 済み — 4 不具合修正済み）

## 着手記録（2026-09-23 — 提出前修正）

addons-linter（AMO アップロード検証と同一チェッカー）とビルド検証の結果:

- **sources.zip が 597MB / 19,581 ファイルで AMO アップロード上限超過**: wxt の既定除外は node_modules / tests / dist のみで、Rust `target/`・coverage・graphify-out・ルートの旧 zip/鍵が全部取り込まれていた。`wxt.config.ts` の `zip.excludeSources`（target・coverage・graphify-out・reports・`video-*` 生成物・`yasumaro-*.zip`・`yasumaro-public.pem`）で **23.6MB / 2,407 ファイル** に縮小。`.env` は wxt の dotfile 既定除外により混入なし（確認済み）
- **`MISSING_DATA_COLLECTION_PERMISSIONS` 警告**: AMO データ開示ポリシー対応として `browser_specific_settings.gecko.data_collection_permissions: { required: ['none'] }` を追加（PRIVACY.md の「開発者への送信なし・ローカル完結、AI 送信はユーザー設定先のみ」主張と整合）
- **`strict_min_version: '140.0'`**: `data_collection_permissions` は Firefox 140 導入キーで、128 など低い最小バージョンを宣言すると AMO 検証が「未対応キー」として警告するため 140 に設定。本ビルドが必要とする機能（MV3 event page・declarativeNetRequest・module workers）はすべて 140 未満で利用可能
- **Firefox for Android は対象外**: Android は MV3 event page background が非対応で本拡張機能は動作しない。AMO 提出時の互換対象は**デスクトップ Firefox のみ**を選択すること（Android 向けの linter 警告 1 件は想定内）
- **検証結果（2026-09-23 2 回目）**: addons-linter **0 errors / 0 warnings / 0 notices**。初回 lint で残った 38 警告を解消 — `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION` は `gecko_android.strict_min_version: '142.0'`（Android は 142 で data_collection_permissions 対応。デスクトップは 140 維持）、`UNSAFE_VAR_ASSIGNMENT` 37 件は動的 innerHTML 代入の排除（新設 `src/utils/htmlFragment.ts` `setElementHtml()` — DOMParser + テーブル文脈 wrap + replaceChildren、script 除去。no-unsanitized ルールは全エスケープ関数を無効化しているため DOM API 化が唯一の解消路）。`npm run validate` green（13,209 passed）
- **dist/ の古い署名成果物**（`yasumaro-6.7.81.zip`・`yasumaro-public.pem` がプロジェクトルートに残留）は sources zip 除外済み。AMO への旧バージョン（6.7.x 系）申請履歴の有無はユーザー側で要確認

### 完了記録（2026-09-26 確認）

- 公開 URL: <https://addons.mozilla.org/ja/firefox/addon/yasumaro-ai-browsing-logger/>
- 公開版: **6.9.17** / 2.89 MB / 最終更新 2026-09-23
- 審査指摘: **なし**。`<all_urls>` の正当化含め審査を通過
- リスティング掲載情報を実ページで確認済み。データ収集開示は `none`、任意権限に
  OpenAI / Google / Anthropic / Groq / Mistral / DeepSeek / Voyage / Volcengine / Z.ai /
  Sakura および localhost の各ポートが列挙されている
- FAQ（ja/en）の Firefox インストール手順と Q7 のインストール元一覧を更新

### 残置（ユーザー作業）

1. 通常版 Firefox への実インストールと 同意→記録→検索 の smoke（実機）
2. 6.9.18 以降を AMO へ提出するかどうかの判断（現在は 6.9.17 で公開中）
3. リスティングのスクリーンショット等 AMAO リソースの差し替えは任意

## 背景

- AMO は `<all_urls>` コンテンツスクリプトの broad host permission 審査が厳格（PBI 11 に記録）。Yasumaro は全ページの閲覧検出に `<all_urls>` が必須のため、権限の必要性の正当化が審査の中心になる
- 初期リリースは GitHub Releases zip 配布を継続する方針（PBI 11）。AMO はその後の拡張判断
- 署名があれば通常版 Firefox への永続インストールが可能になり、Developer Edition + `xpinstall.signatures.required=false` の手順が不要になる

## 実装ガイド

1. **AMO アカウント・リスティング準備**: 拡張機能の説明文・スクリーンショット・プライバシーポリシー（`public/PRIVACY.md` と `docs/PRIVACY.md` の同期を維持）を用意する
2. **署名フロー整備**: `wxt submit` または `web-ext sign` による署名を CI/リリース手順に組み込む（`.github/workflows/release.yml` の firefox zip 成果物を署名対象にする）
3. **権限正当化文の準備**: `<all_urls>` が必要な理由（全ページの閲覧検出・コンテンツスクリプトによるエンゲージメント計測）を審査向けに文書化する。要求されうる権限範囲の縮小は製品仕様の変更を伴うため、別途判断する
4. **配布手順の更新**: 署名版のインストール手順を FAQ（ja/en）に追記する

### 触ってはいけないもの（本 PBI の範囲外）

- 製品コードの機能変更（審査指摘で要求された場合のみ別 PBI で対応）
- `support/6.8` ブランチ（stable ラインと無関係）

## BDD受け入れシナリオ

```gherkin
Scenario: AMO からインストールして記録が動く
  Given AMO で署名・公開されたバージョンがある
  When  通常版 Firefox に AMO からインストールする
  Then  署名エラーなくインストールでき、同意→記録→検索の一連が動作する

Scenario: 審査で指摘が返ってくる
  Given AMO 審査で権限の正当化を求められた
  When  正当化文を提出する
  Then  指摘が解消するか、仕様変更が必要な場合は別 PBI として起票される
```

## 受け入れ基準

- [x] AMO で署名・公開されている
- [ ] 通常版 Firefox に AMO からインストールして同意→記録→検索が動作する → **ユーザー作業**（実機確認）
- [x] FAQ（ja/en）に署名版のインストール手順が記載されている
- [x] 審査指摘があった場合の対応記録が残っている（指摘なしで通過）

## テスト戦略

- E2E: AMO 署名版のインストール → 同意 → 記録 → 検索（PBI 10 の smoke を署名版で再実行）
- 手動: 審査提出前のリスティング内容確認

## 見積もり

1〜2人日 + 審査待ち（審査期間は Mozilla 側のキューに依存し、見積もりに含めない）

## Definition of Done

- [ ] 全BDDシナリオが完了している → 公開は完了。**署名版での実機 smoke（同意→記録→検索）はユーザー作業**
- [x] コードレビュー完了（提出前修正は addons-linter 0 errors / 0 warnings / 0 notices で確認）
- [x] ドキュメント更新済み（FAQ ja/en のインストール手順を AMO 公開に更新）
