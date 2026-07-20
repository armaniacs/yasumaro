# PBI: サプライチェーン脆弱性対応 — adm-zip と runtime 依存のピン留め緩和

元指摘: Checking Team (High: Supply Chain & Dependency Sentinel)

## 実装状況（調査日: 2026-07-20、状態: ⬜ 未着手）

## ユーザーストーリー

開発チームとして、推移的依存関係 `adm-zip` の HIGH 脆弱性 (GHSA-xcpc-8h2w-3j85, CVSS 7.5) を解消し、runtime 依存関係の patch 更新を自動化したい。なぜなら、現在 `firefox-profile` → `web-ext-run` → `wxt` の経路で `adm-zip@~0.5.x` が残っており、また `@subframe7536/sqlite-wasm` 等の runtime 依存が exact version で固定されているためセキュリティパッチが適用されないから。

## ビジネス価値

- ビルドパイプラインのセキュリティ向上
- セキュリティパッチの自動適用
- `npm audit` HIGH 警告の解消

## 前提・制約

- `package-lock.json` には `adm-zip: ^0.6.0` と `adm-zip: ~0.5.x` の2バージョンが混在
- 脆弱性のあるのは `node_modules/firefox-profile/node_modules/adm-zip` (`~0.5.x`)
- `npm audit` の `fixAvailable` は `wxt` の更新を示唆
- runtime 依存: `@subframe7536/sqlite-wasm: "1.3.1"`, `bloomfilter: "1.1.0"`, `wa-sqlite: "1.0.0"`（exact pin）

## BDD受け入れシナリオ

```gherkin
Feature: Supply chain security

  Scenario: adm-zip vulnerability is resolved
    Given npm audit runs
    Then no HIGH severity adm-zip advisories are reported

  Scenario: Runtime deps accept patch updates
    Given a patch version of wa-sqlite is released
    When `npm update` runs
    Then the patch is applied automatically

  Scenario: CI runs npm audit
    Given a PR introduces a vulnerable dependency
    When CI runs
    Then the audit step fails and blocks merge
```

## 受け入れ基準

- [ ] `adm-zip` の HIGH 脆弱性が `npm audit` で検出されなくなる（`wxt` 更新または `overrides` 適用）
- [ ] runtime 依存 (`@subframe7536/sqlite-wasm`, `bloomfilter`, `wa-sqlite`) を `~` 指定に変更（WASM バイナリのため major/minor は固定、patch は自動更新）
- [ ] CI (`ci.yml`) に `npm audit` ステップを追加（`--audit-level=high` 等）
- [ ] `npm run type-check` / `npm test` が成功

## テスト戦略

### 単体テスト
- なし（依存関係変更のみ）

### 統合テスト
- `npm audit` が HIGH を返さないことを確認
- ビルドが成功し、拡張機能が正常に動作することを手動確認

## 実装アプローチ

- **Step 1**: `npm audit` を実行し、最新の `wxt` で解消されるか確認
- **Step 2**: `wxt` 更新が困難な場合、`package.json` の `overrides` に `"adm-zip": ">=0.6.0"` を追加
- **Step 3**: runtime 依存の exact pin を `~` に変更
- **Step 4**: `npm install` して `package-lock.json` を更新
- **Step 5**: CI に audit ステップ追加

## 見積もり
1pt（依存関係更新 + CI 追加）

## 副作用
🟢 なし — ビルド/開発環境のみ。ただし `wxt` メジャーアップデートは避け、影響範囲を最小化する。

## 落とし穴
- `overrides` で `adm-zip` を強制上書きすると、`firefox-profile` の互換性が損なわれる可能性がある。CI テストで検証。
- `wa-sqlite` の patch 更新は WASM バイナリを含むため、ビルド後の動作確認が必須。
- `npm audit` を CI で fail にすると、新たな advisory 発見時に即座にブロックされる。運用方針を決めておく（定期修正日等）。

## Definition of Done
- [ ] すべての受け入れ基準を満たす
- [ ] `npm audit` が HIGH 警告を返さない
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
