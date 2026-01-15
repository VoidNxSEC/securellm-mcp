# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2025-01-15

### Added
- **Semantic Cache**: Embedding-based query caching for 50-70% cost reduction
  - Semantic similarity detection for duplicate queries
  - Automatic TTL-based cache expiration
  - Real-time hit/miss rate metrics
- **Smart Rate Limiter**: Production-grade request management
  - Per-provider FIFO queuing with configurable limits
  - Circuit breaker pattern with automatic failure detection
  - Exponential backoff with jitter for retries
  - Prometheus metrics export (latency percentiles, error categorization, queue depths)
- **Knowledge Management System**: Persistent learning infrastructure
  - SQLite + FTS5 full-text search with Porter stemming
  - Session-based conversation tracking
  - Structured entry storage (insights, decisions, code, references)
  - Priority classification system (high/medium/low)
  - Project file system watcher for automatic knowledge extraction
- **NixOS Development Tools**: Comprehensive tooling for Nix ecosystem
  - Package debugger for diagnosing build failures
  - Flake operations (build, update, manage)
  - Build analyzer with performance profiling
  - SHA256 hash calculator for fetchurl/fetchFromGitHub
  - Configuration generator for Nix expressions
- **Emergency Framework**: Laptop protection during intensive operations
  - Real-time thermal monitoring (CPU/GPU)
  - Pre-build safety checks with thermal validation
  - Automatic throttling and cooldown enforcement
  - Forensic analysis with detailed post-build reports
  - War room mode for live critical operation monitoring
- **Hybrid Reasoning System** (Beta): Next-generation AI capabilities
  - Context inference engine with automatic entity extraction
  - Proactive action engine for preparatory checks
  - Multi-step task planner with dependency ordering
  - Causal reasoning for change impact prediction
  - Adaptive learning from interaction feedback
- **SSH Advanced Tools Suite**: Enterprise-grade remote execution
  - Connection pooling and session management
  - SSH tunneling (local, remote, dynamic port forwarding)
  - Jump host support for multi-hop connections
  - Session persistence and automatic reconnection
- **Browser Automation**: Web interaction capabilities
  - Puppeteer-based browser automation
  - Screenshot capture and DOM interaction
  - Form filling and navigation
- **Research Agent**: Deep technical research capabilities
  - Multi-source information gathering
  - Topic analysis and synthesis
  - Configurable search depth
- **Codebase Analysis Tools**: Code quality and maintainability analysis
  - Complexity analysis (cyclomatic, cognitive, maintainability metrics)
  - Dead code detection
  - Dependency mapping
- **System Management Tools**: Infrastructure health monitoring
  - Comprehensive health checks
  - Service management (systemd integration)
  - Log analysis with filtering and pattern matching
  - Backup management
- **Observability**: Production-grade monitoring and logging
  - Prometheus metrics endpoint
  - Structured JSON logging with Pino
  - Audit trail for all operations
  - Request/response tracking

### Security
- Fixed ReDoS vulnerability in @modelcontextprotocol/sdk (upgraded to 1.25.2)
  - CVE: GHSA-8r9q-7v3j-jr4g
  - Severity: High
  - Impact: Regular expression denial of service
- Added sandboxed execution framework for tool operations
- Implemented SOPS integration for encrypted secrets management
- OAuth integration for secure authentication

### Changed
- Migrated to MCP SDK 1.25.2 for latest protocol support
- Enhanced error handling across all middleware components
- Improved rate limiter with better queue management
- Optimized semantic cache lookup performance (< 10ms)

### Fixed
- Race conditions in rate limiter queue management
- Memory leaks in long-running semantic cache operations
- SSH connection pool cleanup issues
- Knowledge database FTS5 indexing edge cases

### Performance
- Semantic cache lookup: < 10ms (in-memory)
- Knowledge DB search: < 50ms (FTS5 indexed)
- Rate limiter overhead: < 5ms per request
- Circuit breaker decision: < 1ms

### Documentation
- Comprehensive README with architecture diagrams
- API documentation for all MCP resources
- Integration guides for Claude Desktop and Cline
- Usage examples for all major features
- Architecture documentation in docs/ directory

## [1.0.0] - 2024-11-01

### Added
- Initial MCP server implementation
- Basic tool registration system
- Configuration management
- Project root detection
- NixOS host detection
- Basic logging infrastructure

### Documentation
- Initial README
- Basic usage instructions

[2.0.0]: https://github.com/VoidNxSEC/securellm-mcp/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/VoidNxSEC/securellm-mcp/releases/tag/v1.0.0
