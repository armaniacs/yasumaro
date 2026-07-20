# PII サンドボックスページ設計書 / PII Sandbox Page Design

## 1. 目的 / Goal

Yasumaro を注意深く利用したいユーザーが、拡張機能をインストールせずに Web ブラウザ上で PII マスキングの動作を確認できる GitHub Pages ページを作成する。

Create a GitHub Pages page where cautious users can verify Yasumaro's PII masking behavior directly in a web browser, without installing the extension.

## 2. 背景 / Background

- PBI-06 で EU 圏 PII パターン（IBAN、DE 税 ID、FR INSEE、IT Codice Fiscale、ES DNI/NIE）を追加した。
- これらが実際にどうマスクされるかを、誰でも簡単に試せる場所が必要。
- 既存の `docs/index.html` はランディングページ、`docs/PII_FEATURE_GUIDE.md` は解説ドキュメントだが、**実際に入力して試せる場所**がない。

## 3. 設計方針 / Design Decisions

### 3.1 対象パターン

**全 PII パターン**をカバーする。

| 地域 | パターン |
|------|----------|
| 日本 | email、phoneJp、myNumber、driverLicense、jpPassport、bankAccount |
| 米国 | ssn、phoneUs、creditCard |
| 中国 | phoneCn、idCn |
| 韓国 | phoneKr、rrnKr |
| EU | iban、deTaxId、frInsee、itCodiceFiscale、esDni、esNie |
| ネットワーク | ipv4、ipv6 |

### 3.2 マスキングロジックの出所

`src/utils/piiSanitizer.ts` の `sanitizeRegex()` をそのままブラウザ用 JS にバンドルして使用する。

**なぜか**
- パターンだけを再実装すると、Luhn 検証やオーバーラップ解決の有無で拡張機能と異なる結果になりうる。
- `sanitizeRegex()` をそのまま使うことで、拡張機能と同じコードパスを走らせられる。
- graphify 調査で、`piiSanitizer.ts` の依存は `luhn.ts` と `errorUtils.ts` のみで、いずれもブラウザ互換な純粋関数であることを確認済み。

### 3.3 マスク位置情報の取得

`sanitizeRegex()` は返り値の `maskedItems` から位置情報 `index` を破棄している。ハイライト表示のために、`SanitizeOptions` に `includeIndices?: boolean` を追加する。

**なぜか**
- デフォルト `false` で既存の拡張機能呼び出しに影響を与えない。
- 型定義上 `MaskedItem.index` は既に `?`（オプショナル）となっており、後方互換。

### 3.4 ページ構成

専用ページ `docs/pii-sandbox.html` を作成する。

**なぜか**
- URL を直接共有しやすい。
- 既存ランディングページ `docs/index.html` の構造を壊さない。
- 将来的にテストケースを増やしやすい。

### 3.5 言語対応

日英バイリンガル。

**なぜか**
- `docs/index.html` や `PII_FEATURE_GUIDE.md` と同じく、日本語・英語の両方のユーザーに対応。
- PII マスキングは国際的な関心事。

### 3.6 インタラクション

自由入力エリアとプリセット例ボタンの両方を設置する。

**なぜか**
- ユーザーは自分の実際のテキストで試したい場合と、何がマスクされるか学びたい場合の両方がある。

## 4. ページ UI / Page UI

### 4.1 レイアウト

既存 `docs/index.html` と同じダークテーマ・スタイル（CSS 変数、フォント、角丸等）を踏襲する。

```
┌─────────────────────────────────────┐
│  Nav（Yasumaro ロゴ + 言語切り替え）  │
├─────────────────────────────────────┤
│  タイトル + 簡単な説明文              │
├─────────────────────────────────────┤
│  プリセット例ボタン群                 │
│  [email] [phoneJp] [creditCard] ...  │
├─────────────────────────────────────┤
│  入力テキストエリア                   │
│  （placeholder: テキストを貼り付け）  │
├─────────────────────────────────────┤
│  実行ボタン                           │
├─────────────────────────────────────┤
│  出力エリア                           │
│  - マスク後テキスト                   │
│  - マスク箇所ハイライト（元テキスト） │
│  - サマリーカード                     │
│  - 個別マスク一覧                     │
└─────────────────────────────────────┘
```

### 4.2 プリセット例

各 PII タイプごとに、マスクされることが確認できる最小限のサンプルテキストを用意する。
例：
- `email`: `contact@example.com`
- `creditCard`: `4111-1111-1111-1111`
- `iban`: `DE89370400440532013000`
- `deTaxId`: `12345678901`

### 4.3 出力表示

1. **マスク後テキスト**: `[MASKED:email]` 形式で表示
2. **ハイライト表示**: 元テキスト中のマスク箇所を色付き背景で強調
3. **サマリー**: タイプ別の検出件数を表またはカードで表示
4. **個別一覧**: タイプと元の値をテーブルで表示

## 5. データフロー / Data Flow

```
[ユーザー入力 or プリセット]
        ↓
[docs-src/pii-sandbox.ts]
        ↓
[sanitizeRegex(text, { includeIndices: true })]
        ↓
[docs/assets/pii-sandbox.js]
        ↓
[HTML UI: マスク後テキスト / ハイライト / サマリー / 一覧]
```

## 6. ビルド連携 / Build Integration

### 6.1 新規ファイル

- `docs-src/pii-sandbox.ts` — エントリーポイント。`sanitizeRegex()` をラップし、HTML から `PiiSandbox.*` として呼び出せる関数を IIFE グローバルに公開する
- `docs/pii-sandbox.html` — ページ

### 6.2 ビルドコマンド

`package.json` の `scripts` に追加：

```json
"build:docs-pii": "esbuild docs-src/pii-sandbox.ts --bundle --outfile=docs/assets/pii-sandbox.js --format=iife --global-name=PiiSandbox"
```

`esbuild` は vite の中核ツールなため、追加してもエコシステムに一貫性がある。

### 6.3 ワークフロー更新

`.github/workflows/pages.yml` の `Generate API docs (typedoc)` ステップの直後に追加：

```yaml
- name: Build PII sandbox bundle
  run: npm run build:docs-pii
```

## 7. 既存ページへの導線 / Navigation

- `docs/index.html`: ナビゲーションまたは Features セクションに「PII Sandbox」リンクを追加
- `docs/PII_FEATURE_GUIDE.md`: 「PII検出 (Regex)」セクションに「実際に試す」リンクを追加

## 8. テスト戦略 / Testing

- **ビルドテスト**: `npm run build:docs-pii` が成功し、`docs/assets/pii-sandbox.js` が生成されることを CI で確認
- **動作テスト**: 生成されたページで主要 PII パターンがマスクされることを手動確認
- **回帰テスト**: `piiSanitizer.ts` の変更（`includeIndices` 追加）に伴い、既存テストを追加・更新

## 9. ファイル変更一覧 / Files to Modify

### 新規作成
- `docs-src/pii-sandbox.ts`
- `docs/pii-sandbox.html`

### 変更
- `src/utils/piiSanitizer.ts` — `includeIndices` オプション追加
- `package.json` — `build:docs-pii` スクリプトと `esbuild` devDependency 追加
- `package-lock.json` — 依存更新
- `.github/workflows/pages.yml` — ビルドステップ追加
- `docs/index.html` — ナビゲーションリンク追加
- `docs/PII_FEATURE_GUIDE.md` — リンク追加

## 10. リスクと対応 / Risks

| リスク | 対応 |
|--------|------|
| `esbuild` 依存追加 | vite と同じエコシステムのため影響小。devDependency のみ |
| `piiSanitizer.ts` 変更による回帰 | `includeIndices` はデフォルト false。テストでカバー |
| GitHub Pages デプロイ失敗 | ワークフローにビルドステップを追加し、pages.yml の paths トリガーに `docs-src/**` を含める |

## 11. 未決定事項 / Open Questions

- `esbuild` を `devDependencies` に直接追加するか、`vite` 経由で利用するか（推奨: 直接追加）
- PII サンプルテキストを `docs-src/pii-sandbox.ts` にハードコードするか、別 JSON ファイルに分離するか（推奨: 同ファイル内の定数として簡潔に管理）
