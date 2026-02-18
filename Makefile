.PHONY: build clean test test-watch test-coverage test-e2e type-check validate

build:
	npm run build

clean:
	npm run clean

test:
	npm test

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
