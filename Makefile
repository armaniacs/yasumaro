.PHONY: build clean test test-watch test-coverage test-e2e type-check validate test-news test-news-watch local-ci test-all

build:
	npm run build

clean:
	npm run clean

test: build
	npm run validate && npm run test:e2e

test-watch:
	npm run test:watch

test-coverage:
	npm run test:coverage

test-e2e: build
	npm run test:e2e

type-check:
	npm run type-check

validate:
	npm run validate

test-and-build: build test

# 全テスト: unit + ニュース統合 + E2E + local-ci（act + Docker が必要）
test-all: build
	npm run validate
	npm test -- src/utils/aiSummaryCleaner/__tests__/newsIntegration.test.ts
	npm run test:e2e
	act push --job validate --container-architecture linux/amd64 -W .github/workflows/ci.yml

# GitHub Actions CI をローカルで再現（act + Docker が必要）
local-ci:
	act push --job validate --container-architecture linux/amd64 -W .github/workflows/ci.yml

# ニュースサイト統合テスト
test-news:
	npm test -- src/utils/aiSummaryCleaner/__tests__/newsIntegration.test.ts

test-news-watch:
	npm run test:watch -- src/utils/aiSummaryCleaner/__tests__/newsIntegration.test.ts
