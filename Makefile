.PHONY: help install build build-node build-rust dev watch test test-node test-rust coverage lint format check clean nix-dev nix-build

# Default target
help:
	@echo "SecureLLM MCP Server - Unified Development Makefile"
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@echo "Environment & Setup:"
	@echo "  install      Install Node.js dependencies"
	@echo "  nix-dev      Enter the Nix development environment (nix develop)"
	@echo "  nix-build    Build the project using Nix flakes"
	@echo ""
	@echo "Build:"
	@echo "  build        Build all components (Node.js & Rust)"
	@echo "  build-node   Build Node.js/TypeScript code"
	@echo "  build-rust   Build Rust crates in release mode"
	@echo ""
	@echo "Development:"
	@echo "  dev          Run Node.js dev server with hot-reload (nodemon)"
	@echo "  watch        Run TypeScript compiler in watch mode"
	@echo ""
	@echo "Testing:"
	@echo "  test         Run all tests (Node.js & Rust)"
	@echo "  test-node    Run Node.js tests"
	@echo "  test-rust    Run Rust tests"
	@echo "  coverage     Run Node.js tests with coverage reporting (c8)"
	@echo ""
	@echo "Quality Control:"
	@echo "  lint         Run linters (ESLint & Clippy)"
	@echo "  format       Format codebase (Prettier & Rustfmt)"
	@echo "  check        Check code formatting without modifying files"
	@echo ""
	@echo "Cleanup:"
	@echo "  clean        Remove build artifacts, dependencies, and target directories"

# Setup targets
install:
	npm install

nix-dev:
	nix develop

nix-build:
	nix build

# Build targets
build: build-node build-rust

build-node:
	npm run build

build-rust:
	@if [ -d "crates/agent-core" ]; then \
		cd crates/agent-core && cargo build --release; \
	else \
		echo "Rust crates directory not found. Skipping rust build."; \
	fi

# Development targets
dev:
	npm run dev

watch:
	npm run watch

# Testing targets
test: test-node test-rust

test-node:
	npm test

test-rust:
	@if [ -d "crates/agent-core" ]; then \
		cd crates/agent-core && cargo test; \
	else \
		echo "Rust crates directory not found. Skipping rust tests."; \
	fi

coverage:
	npm run test:coverage

# Quality targets
lint:
	npm run lint
	@if [ -d "crates/agent-core" ]; then \
		cd crates/agent-core && cargo clippy -- -D warnings; \
	fi

format:
	npm run format
	@if [ -d "crates/agent-core" ]; then \
		cd crates/agent-core && cargo fmt; \
	fi

check:
	npm run format:check
	@if [ -d "crates/agent-core" ]; then \
		cd crates/agent-core && cargo fmt -- --check; \
	fi

# Cleanup target
clean:
	rm -rf build node_modules coverage
	@if [ -d "crates/agent-core" ]; then \
		cd crates/agent-core && cargo clean; \
	fi
