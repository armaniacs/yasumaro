# ADR-001: Privacy Detection Logic Refinement

## Status

**Accepted** (2026-02-21)

## Context（背景・経緯）

### 初期実装での問題

Obsidian Smart Historyのプライバシー判定機能（`src/utils/privacyChecker.ts`）は、HTTPレスポンスヘッダーを解析してプライベートページを自動判定する機能として実装されました。初期設計（[Private Page Detection Design](../plans/2026-02-20-private-page-detection-design.md)）では、以下の条件でプライベートページと判定していました：

1. `Cache-Control: private`, `no-store`, `no-cache` のいずれかが含まれる
2. `Set-Cookie` ヘッダーが存在する
3. `Authorization` ヘッダーが存在する

しかし、実際の運用において**誤検知**が発生することが判明しました。

### 発見された具体的な問題

#### 1. `no-store` 単独での誤判定

**サイト例**: 読売新聞オリンピック結果ページ
- URL: `https://www.yomiuri.co.jp/olympic/2026/results/FSK/`
- ヘッダー: `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`
- 現象: 公開ページであるにもかかわらずプライベート判定される

**原因**: `no-store` は「キャッシュを一切保存してはならない」という意味であり、プライバシー保護だけでなく「常に最新データを取得したい」場合にも使用される。ニュースサイト、スポーツ速報、株価情報などの公開ページでも頻繁に使用される。

#### 2. `Set-Cookie` 単独での誤判定

**サイト例**: CNN記事ページ
- URL: `https://edition.cnn.com/2026/02/20/science/ancient-elephant-bone-spain-scli-intl`
- ヘッダー: `Set-Cookie` あり
- 現象: 公開ページであるにもかかわらずプライベート判定される

**原因**: `Set-Cookie` はトラッキングCookie（`_ga`, `_gid`, `_fbp`など）や分析用Cookieとして公開ページでも広く使用される。Cookie の存在だけではユーザー固有のコンテンツかどうか判断できない。

### 技術的背景（RFC仕様）

#### RFC 7234 - HTTP Caching

- **`private`**: 共有キャッシュ（CDN/プロキシ）での保存を禁止。明確に「ユーザー専用の応答」と定義されている。
- **`no-store`**: キャッシュを一切保存してはならない。機密性の高いページだけでなく、常に最新データを提供したいページでも使用される。
- **`no-cache`**: キャッシュ可能だが使用前に必ず再検証が必要。「再検証必須」を意味するだけで、プライバシーとは無関係。

#### RFC 6265 - HTTP State Management (Cookies)

- `Set-Cookie` ヘッダーはセッション管理だけでなく、トラッキング、分析、A/Bテスト、広告配信など多目的に使用される。

#### RFC 7231 Section 7.1.4 - Vary Header

- **`Vary: Cookie`**: サーバーが「このレスポンスは Cookie ヘッダーの値によって変わる」と宣言している。
- これは、**同じURLでも見る人（Cookie）によって内容が異なる**ことを意味する。
- ユーザーごとにコンテンツを出し分けている明確な証拠となる。

## Decision（決定事項）

以下の **4つの条件** でプライベートページと判定する：

### 1. `Cache-Control: private`

```
Cache-Control: private
```

→ **プライベート判定**

**理由**: RFC 7234で明示的に「ユーザー専用の応答」と定義されている。CDN/プロキシでの共有キャッシュを禁止する意図がある。

### 2. `Cache-Control: no-store` + `Set-Cookie`

```
Cache-Control: no-store, no-cache, must-revalidate
Set-Cookie: session=abc123
```

→ **プライベート判定**

**理由**: キャッシュ完全禁止かつCookie使用は、ユーザー固有のセッション管理の可能性が高い。機密性の高いページ（銀行サイト、個人情報ページ）の典型的なパターン。

### 3. `Set-Cookie` + `Vary: Cookie`

```
Set-Cookie: session=abc123
Vary: Cookie, Accept-Encoding
```

→ **プライベート判定**

**理由**: サーバーが「見る人（Cookie）によってコンテンツを出し分けている」と宣言している。これはユーザー固有のコンテンツ（SNSタイムライン、メール、ダッシュボード）の明確な証拠。

### 4. `Authorization`

```
Authorization: Bearer token123
```

→ **プライベート判定**

**理由**: HTTP認証ヘッダーは明確に認証済みユーザー向けコンテンツを示す。

### 判定しない条件（誤検知の防止）

以下の条件では**プライベート判定しない**：

- **`no-store` 単独** → ニュースサイト、スポーツ速報など公開ページでも使用される
- **`Set-Cookie` 単独** → トラッキングCookie、分析Cookieなど公開ページでも広く使用される
- **`no-cache`** → 「再検証必須」を意味するだけで、プライバシーとは無関係

## Rationale（根拠・理由）

### なぜ `no-store` 単独では判定しないのか

`no-store` の本来の目的は「キャッシュを一切保存しない」ことであり、以下の2つの用途がある：

1. **プライバシー/セキュリティ**: 個人情報や機密情報を含むページ
2. **常に最新データを提供**: ニュースサイト、スポーツ速報、株価情報など

両者を区別するには、追加のシグナル（`Set-Cookie` の存在）が必要。

### なぜ `Set-Cookie` 単独では判定しないのか

`Set-Cookie` は多目的に使用される：

1. **セッション管理**: ログイン後の認証トークン（プライベート）
2. **トラッキング**: `_ga`, `_gid`, `_fbp`（パブリック）
3. **分析**: A/Bテスト、行動分析（パブリック）
4. **広告**: 広告配信の最適化（パブリック）

セッション管理とトラッキングを区別するには、`Vary: Cookie` の存在を確認する必要がある。

### なぜ `Vary: Cookie` が重要なのか

`Vary: Cookie` は、サーバーが「このレスポンスはCookieの値によって変わる」と明示的に宣言している。これは：

- 同じURLでも、ユーザー（Cookie）ごとに異なるコンテンツを返している
- ユーザー固有の情報（SNSタイムライン、メール、個人設定）が含まれている可能性が高い

逆に、`Vary: Cookie` がない場合は、Cookieはトラッキング目的であり、コンテンツ自体は全ユーザー共通と判断できる。

### 組み合わせ判定の有効性

| 条件 | 判定 | 典型例 |
|------|------|--------|
| `no-store` のみ | パブリック | ニュースサイト、スポーツ速報 |
| `Set-Cookie` のみ | パブリック | トラッキングCookie付き記事 |
| `no-store` + `Set-Cookie` | **プライベート** | 銀行サイト、個人情報ページ |
| `Set-Cookie` + `Vary: Cookie` | **プライベート** | SNS、メール、ダッシュボード |
| `Cache-Control: private` | **プライベート** | 明示的なプライベート指定 |
| `Authorization` | **プライベート** | HTTP認証必須ページ |

## Consequences（影響）

### Positive（良い影響）

1. **誤検知の大幅な削減**
   - 読売新聞、CNNなど公開ニュースサイトが正しくパブリックと判定される
   - ユーザーが意図しない警告ダイアログに悩まされない

2. **真にプライベートなページの正確な識別**
   - 銀行サイト、個人情報ページ、SNSタイムラインなどを正確に判定
   - プライバシー保護の実効性が向上

3. **RFC仕様に準拠した判定ロジック**
   - HTTPヘッダーの本来の意味を尊重
   - 標準的なWeb技術との整合性を確保

4. **保守性の向上**
   - 判定理由が明確（RFC仕様に基づく）
   - 将来的な仕様変更への追従が容易

### Negative（考慮すべき点）

1. **やや複雑な判定ロジック**
   - 4条件の組み合わせ判定が必要
   - テストケースの増加（11ケース）

2. **将来的なエッジケース発見の可能性**
   - まだ検証していないサイトで誤判定が発生する可能性
   - 継続的なモニタリングと改善が必要

3. **`Vary: Cookie` 非対応サイトへの影響**
   - 一部のサイトは `Vary: Cookie` を設定していない可能性
   - ただし、これらは偽陰性（プライベートなのにパブリック判定）となり、誤検知（偽陽性）よりは許容できる

## Implementation（実装）

### 修正ファイル

#### `src/utils/privacyChecker.ts`

```typescript
export function checkPrivacy(headers: chrome.webRequest.HttpHeader[]): PrivacyInfo {
  const timestamp = Date.now();

  const cacheControl = findHeader(headers, 'cache-control');
  const hasCookie = hasHeader(headers, 'set-cookie');
  const hasAuth = hasHeader(headers, 'authorization');
  const vary = findHeader(headers, 'vary');
  const varyCookie = vary?.value?.toLowerCase().includes('cookie') || false;

  if (cacheControl) {
    const value = cacheControl.value?.toLowerCase() || '';

    // 1. private ディレクティブは単独でプライベート判定
    if (value.includes('private')) {
      return {
        isPrivate: true,
        reason: 'cache-control',
        timestamp,
        headers: { cacheControl: cacheControl.value, hasCookie, hasAuth }
      };
    }

    // 2. no-store は Set-Cookie と組み合わせた場合のみプライベート判定
    if (value.includes('no-store') && hasCookie) {
      return {
        isPrivate: true,
        reason: 'cache-control',
        timestamp,
        headers: { cacheControl: cacheControl.value, hasCookie, hasAuth }
      };
    }
  }

  // 3. Set-Cookie + Vary: Cookie でプライベート判定
  if (hasCookie && varyCookie) {
    return {
      isPrivate: true,
      reason: 'set-cookie',
      timestamp,
      headers: { cacheControl: cacheControl?.value, hasCookie: true, hasAuth }
    };
  }

  // 4. Authorization でプライベート判定
  if (hasAuth) {
    return {
      isPrivate: true,
      reason: 'authorization',
      timestamp,
      headers: { cacheControl: cacheControl?.value, hasCookie: false, hasAuth: true }
    };
  }

  // いずれも該当しない
  return {
    isPrivate: false,
    timestamp,
    headers: { cacheControl: cacheControl?.value, hasCookie, hasAuth }
  };
}
```

### テストファイル

#### `src/utils/__tests__/privacyChecker.test.ts`

**テスト結果**: 11/11 pass

主要なテストケース：

1. `Cache-Control: private` → プライベート判定
2. `Cache-Control: no-store` 単独 → パブリック判定（誤検知防止）
3. `Cache-Control: no-store` + `Set-Cookie` → プライベート判定
4. `Cache-Control: no-cache` → パブリック判定（誤検知防止）
5. `Set-Cookie` 単独 → パブリック判定（誤検知防止）
6. `Set-Cookie` + `Vary: Cookie` → プライベート判定
7. `Authorization` → プライベート判定
8. 複数条件の優先順位
9. プライベートヘッダーなし → パブリック判定
10. 空ヘッダー → パブリック判定

## Examples（実際の動作例）

### 1. 読売新聞オリンピック結果（パブリック）

```
URL: https://www.yomiuri.co.jp/olympic/2026/results/FSK/
Headers:
  Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate
  Set-Cookie: (なし)

判定: パブリック（記録される）
理由: no-store 単独では判定しない
```

### 2. CNN記事（パブリック）

```
URL: https://edition.cnn.com/2026/02/20/science/...
Headers:
  Set-Cookie: _ga=GA1.2.123456789; _gid=GA1.2.987654321
  Vary: Accept-Encoding

判定: パブリック（記録される）
理由: Vary: Cookie がないため、Cookieはトラッキング用途
```

### 3. ログイン後のSNSタイムライン（プライベート）

```
URL: https://example.com/timeline
Headers:
  Set-Cookie: session=abc123; HttpOnly; Secure
  Vary: Cookie, Accept-Encoding

判定: プライベート（記録されない）
理由: Vary: Cookie があり、ユーザーごとにコンテンツを出し分け
```

### 4. 銀行サイト（プライベート）

```
URL: https://bank.example.com/account
Headers:
  Cache-Control: private, no-store, no-cache
  Set-Cookie: JSESSIONID=xyz789

判定: プライベート（記録されない）
理由: Cache-Control: private が明示的に設定されている
```

### 5. セッション管理ページ（プライベート）

```
URL: https://app.example.com/dashboard
Headers:
  Cache-Control: no-store, must-revalidate
  Set-Cookie: auth_token=token123

判定: プライベート（記録されない）
理由: no-store + Set-Cookie の組み合わせ
```

## References（参照）

### RFC仕様書

- [RFC 7234 - HTTP/1.1 Caching](https://datatracker.ietf.org/doc/html/rfc7234)
  - Section 5.2.2.3: `no-store` ディレクティブ
  - Section 5.2.2.6: `private` ディレクティブ
- [RFC 6265 - HTTP State Management Mechanism (Cookies)](https://datatracker.ietf.org/doc/html/rfc6265)
  - Section 4.1: Set-Cookie ヘッダー
- [RFC 7231 - Hypertext Transfer Protocol (HTTP/1.1): Semantics and Content](https://datatracker.ietf.org/doc/html/rfc7231)
  - Section 7.1.4: Vary ヘッダー

### プロジェクト内ドキュメント

- [Private Page Detection Design](../plans/2026-02-20-private-page-detection-design.md) - 初期設計ドキュメント
- [DESIGN_SPECIFICATIONS.md](../../DESIGN_SPECIFICATIONS.md) - 全体的な設計仕様

### 実装ファイル

- `src/utils/privacyChecker.ts` - プライバシー判定ロジック実装
- `src/utils/__tests__/privacyChecker.test.ts` - ユニットテスト
- `src/background/headerDetector.ts` - HTTPヘッダー監視
- `src/background/recordingLogic.ts` - 記録ロジック統合

## まとめ

この設計判断により、HTTPヘッダーの仕様（RFC）に準拠した正確なプライバシー判定が可能になりました。`no-store` や `Set-Cookie` の単独での誤検知を防ぎつつ、`Vary: Cookie` などの追加シグナルを活用することで、真にプライベートなページを高精度で識別できます。

今後も実際のサイトでの検証を継続し、必要に応じて判定ロジックを改善していくことが重要です。
