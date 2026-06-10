# ADR: CSP 二層セキュリティモデル

## ステータス
採用済み

## 日付
2026-03-17

## コンテキスト
`manifest.json` の `connect-src` には全対応 AI プロバイダードメインが列挙されている。一方、`src/utils/cspValidator.ts` はユーザーが設定したプロバイダーのドメインのみ許可する。矛盾しているように見えるが、これは意図的な設計である。

## 関連するADR
- なし

## 決定事項
二層構造として設計する：

### 第一層: manifest.json connect-src（上限）
- Chrome Extension が技術的に接続 *できる* ドメインの上限値
- 全対応プロバイダーを列挙（ユーザーが将来選択する可能性があるもの）
- Chrome が強制するブラウザレベルのポリシー

### 第二層: CSPValidator（実行時フィルタリング）
- ユーザーが実際に設定したプロバイダーのドメインのみを許可
- manifest.json より厳格な実行時ガード
- `src/utils/cspValidator.ts` が管理

## 結果

### メリット
- ブラウザレベルの強力なガード（第一層）と実行時の柔軟なフィルタリング（第二層）の組み合わせ
- 新プロバイダー追加時に両層で検証できる二重チェック
- セキュリティ監査の明確な責任分離

### デメリット
- manifest.json に未使用ドメインが含まれる（意図的。上限として機能）
- 二層管理による設定の複雑化

### 影響範囲
- `manifest.json` (content_security_policy.extension_pages)
- `src/utils/cspValidator.ts`
- 新プロバイダー追加時のチェックリスト更新

## 参照
- [Chrome Extension Content Security Policy](https://developer.chrome.com/docs/extensions/mv3/content_security_policy/)