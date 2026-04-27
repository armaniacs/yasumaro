.PHONY: build clean test test-watch test-coverage test-e2e type-check validate test-news test-news-watch

build:
	npm run build

clean:
	npm run clean

test:
	npm run validate && npm run test:e2e

test-watch:
	npm run test:watch

test-coverage:
	npm run test:coverage

test-e2e:
	npm run test:e2e

type-check:
	npm run type-check

validate:
	npm run validate

test-and-build: test build

# ニュースサイト統合テスト
test-news:
	npm test -- src/utils/aiSummaryCleaner/__tests__/newsIntegration.test.ts

test-news-watch:
	npm run test:watch -- src/utils/aiSummaryCleaner/__tests__/newsIntegration.test.ts
