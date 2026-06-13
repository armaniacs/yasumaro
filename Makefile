# Makefile
#   make build          — copy vendor WASM to node_modules, then wxt build
#   make build-wasm     — rebuild wa-sqlite WASM with FTS5 (requires emscripten)

SHELL := /bin/bash

.PHONY: build build-wasm

build:
	cp vendor/wa-sqlite/wa-sqlite-async.wasm node_modules/wa-sqlite/dist/
	cp vendor/wa-sqlite/wa-sqlite-async.mjs node_modules/wa-sqlite/dist/
	npm run build

build-wasm:
	bash vendor/wa-sqlite/build-wasm.sh
	cp vendor/wa-sqlite/wa-sqlite-async.wasm node_modules/wa-sqlite/dist/
	cp vendor/wa-sqlite/wa-sqlite-async.mjs node_modules/wa-sqlite/dist/
