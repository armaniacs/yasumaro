# verify-vulnhunt-fix report

- Date: 2026-08-30T11:03:57.064Z
- Branch: plan/0830-backlog-execution (Wave 0)
- Purpose: DoD を VulnHunter 再スキャンから変異テスト green に変更 (M1) の検証基盤
- Report: `dev-docs/verify-vulnhunt-2026-08-30.md`

## Overall: PASS

> 全ての検証が green。`pbi/2026-08-29-04/08/14/19` はアーカイブ可能。

## type-check

| step | result | exit |
|------|--------|------|
| `npm run type-check` | PASS | 0 |

<details><summary>type-check output</summary>

```
> yasumaro@6.7.88 type-check
> tsc --noEmit
```

</details>

## vitest

| test file | result | exit |
|-----------|--------|------|
| `src/offscreen/__tests__/payloadGuard-comprehensive.test.ts` | PASS | 0 |
| `src/offscreen/__tests__/payloadGuardSchemaDriven.test.ts` | PASS | 0 |
| `src/utils/__tests__/optimisticLockSerialization.test.ts` | PASS | 0 |
| `src/utils/__tests__/optimisticLock.test.ts` | PASS | 0 |
| `src/utils/__tests__/cspValidatorSelfAllow.test.ts` | PASS | 0 |
| `src/dashboard/__tests__/tagCooccurrenceCap.test.ts` | PASS | 0 |
| `src/utils/__tests__/sentenceExtractorCap.test.ts` | PASS | 0 |
| `src/offscreen/__tests__/browsingLogCodec-comprehensive.test.ts` | PASS | 0 |

### warnings (skipped / alias)

- spec target not found, skipped: `src/utils/__tests__/keySerializer.test.ts`
- spec target not found, skipped: `src/background/__tests__/optimisticLock.test.ts`
- spec target not found, skipped: `src/utils/__tests__/computeLimits.test.ts`
- spec target not found, skipped: `src/background/__tests__/cspValidatorSelfAllow.test.ts`
- alias tests added to cover missing spec paths: `src/utils/__tests__/optimisticLockSerialization.test.ts`, `src/utils/__tests__/optimisticLock.test.ts`, `src/utils/__tests__/cspValidatorSelfAllow.test.ts`, `src/dashboard/__tests__/tagCooccurrenceCap.test.ts`, `src/utils/__tests__/sentenceExtractorCap.test.ts`, `src/offscreen/__tests__/browsingLogCodec-comprehensive.test.ts`

<details><summary>src/offscreen/__tests__/payloadGuard-comprehensive.test.ts (PASS)</summary>

```
RUN  v4.1.11 /Users/yaar/Playground/obsidian-smart-history


 Test Files  1 passed (1)
      Tests  37 passed (37)
   Start at  20:04:00
   Duration  320ms (transform 122ms, setup 166ms, import 21ms, tests 30ms, environment 0ms)


(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - import "./testDir/vitest.config" without a file extension (vitest.config.ts:7:25). Add the file extension
  - `__dirname` (testDir/vitest.config.ts:10:34). Use `import.meta.dirname` instead
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.
```

</details>

<details><summary>src/offscreen/__tests__/payloadGuardSchemaDriven.test.ts (PASS)</summary>

```
RUN  v4.1.11 /Users/yaar/Playground/obsidian-smart-history


 Test Files  1 passed (1)
      Tests  7 passed (7)
   Start at  20:04:09
   Duration  235ms (transform 101ms, setup 133ms, import 14ms, tests 5ms, environment 0ms)


(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - import "./testDir/vitest.config" without a file extension (vitest.config.ts:7:25). Add the file extension
  - `__dirname` (testDir/vitest.config.ts:10:34). Use `import.meta.dirname` instead
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.
```

</details>

<details><summary>src/utils/__tests__/optimisticLockSerialization.test.ts (PASS)</summary>

```
RUN  v4.1.11 /Users/yaar/Playground/obsidian-smart-history


 Test Files  1 passed (1)
      Tests  9 passed (9)
   Start at  20:04:17
   Duration  574ms (transform 132ms, setup 130ms, import 54ms, tests 309ms, environment 0ms)


(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - import "./testDir/vitest.config" without a file extension (vitest.config.ts:7:25). Add the file extension
  - `__dirname` (testDir/vitest.config.ts:10:34). Use `import.meta.dirname` instead
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.
```

</details>

<details><summary>src/utils/__tests__/optimisticLock.test.ts (PASS)</summary>

```
RUN  v4.1.11 /Users/yaar/Playground/obsidian-smart-history


 Test Files  1 passed (1)
      Tests  18 passed (18)
   Start at  20:04:26
   Duration  3.60s (transform 135ms, setup 129ms, import 57ms, tests 3.33s, environment 0ms)


(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - import "./testDir/vitest.config" without a file extension (vitest.config.ts:7:25). Add the file extension
  - `__dirname` (testDir/vitest.config.ts:10:34). Use `import.meta.dirname` instead
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.
```

</details>

<details><summary>src/utils/__tests__/cspValidatorSelfAllow.test.ts (PASS)</summary>

```
RUN  v4.1.11 /Users/yaar/Playground/obsidian-smart-history


 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  20:04:34
   Duration  275ms (transform 138ms, setup 131ms, import 60ms, tests 3ms, environment 0ms)


(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - import "./testDir/vitest.config" without a file extension (vitest.config.ts:7:25). Add the file extension
  - `__dirname` (testDir/vitest.config.ts:10:34). Use `import.meta.dirname` instead
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.
```

</details>

<details><summary>src/dashboard/__tests__/tagCooccurrenceCap.test.ts (PASS)</summary>

```
RUN  v4.1.11 /Users/yaar/Playground/obsidian-smart-history


 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  20:04:43
   Duration  299ms (transform 134ms, setup 160ms, import 21ms, tests 36ms, environment 0ms)


(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - import "./testDir/vitest.config" without a file extension (vitest.config.ts:7:25). Add the file extension
  - `__dirname` (testDir/vitest.config.ts:10:34). Use `import.meta.dirname` instead
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.
```

</details>

<details><summary>src/utils/__tests__/sentenceExtractorCap.test.ts (PASS)</summary>

```
RUN  v4.1.11 /Users/yaar/Playground/obsidian-smart-history


 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  20:04:51
   Duration  452ms (transform 110ms, setup 138ms, import 18ms, tests 210ms, environment 0ms)


(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - import "./testDir/vitest.config" without a file extension (vitest.config.ts:7:25). Add the file extension
  - `__dirname` (testDir/vitest.config.ts:10:34). Use `import.meta.dirname` instead
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.
```

</details>

<details><summary>src/offscreen/__tests__/browsingLogCodec-comprehensive.test.ts (PASS)</summary>

```
RUN  v4.1.11 /Users/yaar/Playground/obsidian-smart-history


 Test Files  1 passed (1)
      Tests  23 passed (23)
   Start at  20:04:59
   Duration  236ms (transform 99ms, setup 131ms, import 18ms, tests 5ms, environment 0ms)


(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - import "./testDir/vitest.config" without a file extension (vitest.config.ts:7:25). Add the file extension
  - `__dirname` (testDir/vitest.config.ts:10:34). Use `import.meta.dirname` instead
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.
```

</details>

## Mapping note

Spec 上の 5件は一部 obsolete パスを含むため、以下の alias で代替検証している:

- `src/utils/__tests__/keySerializer.test.ts` (missing) → `src/utils/__tests__/optimisticLockSerialization.test.ts` (keySerializer primitive + TOCTOU)
- `src/background/__tests__/optimisticLock.test.ts` (missing) → `src/utils/__tests__/optimisticLock.test.ts`
- `src/utils/__tests__/computeLimits.test.ts` (missing) → `src/dashboard/__tests__/tagCooccurrenceCap.test.ts` / `src/utils/__tests__/sentenceExtractorCap.test.ts` / `src/offscreen/__tests__/browsingLogCodec-comprehensive.test.ts` (cap path)
- `src/background/__tests__/cspValidatorSelfAllow.test.ts` (missing) → `src/utils/__tests__/cspValidatorSelfAllow.test.ts`
- `src/offscreen/__tests__/payloadGuard*` → `payloadGuard-comprehensive.test.ts` + `payloadGuardSchemaDriven.test.ts`

PoC は `.gitignore` で失われ再現不可のため、上記既存テスト + type-check で代替検証とする。
