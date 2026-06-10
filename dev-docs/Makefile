.PHONY: build clean test test-watch test-coverage test-e2e type-check validate test-news test-news-watch local-ci test-all lock-linux

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

# 全テスト: unit + ニュース統合 + E2E
test-all: build
	npm run validate
	npm test -- src/utils/aiSummaryCleaner/__tests__/newsIntegration.test.ts
	npm run test:e2e

# package-lock.json を linux/amd64 環境で生成（CI の npm ci と一致させる）
# Mac 上では optional deps（@emnapi/core 等）が異なるため Docker で生成が必要
lock-linux:
	docker run --rm --platform linux/amd64 \
	  -v $(PWD)/package.json:/tmp/pkg/package.json:ro \
	  -v $(PWD):/host \
	  node:24-slim \
	  sh -c "mkdir /work-tmp && cp /tmp/pkg/package.json /work-tmp/ && cd /work-tmp && npm install 2>&1 | tail -3 && cp package-lock.json /host/package-lock.json"
	npm install

# GitHub Actions CI をローカルで再現（act + Docker が必要）
# 注意: Mac 上の linux/amd64 QEMU エミュレーションはメモリ制限があり
#       テスト全体は落ちる場合がある。npm ci の動作確認が主な用途。
local-ci:
	act push --job validate --container-architecture linux/amd64 -W .github/workflows/ci.yml

# ニュースサイト統合テスト
test-news:
	npm test -- src/utils/aiSummaryCleaner/__tests__/newsIntegration.test.ts

test-news-watch:
	npm run test:watch -- src/utils/aiSummaryCleaner/__tests__/newsIntegration.test.ts
