# Contributing to SecureLLM MCP Server

Thank you for your interest in contributing to SecureLLM MCP! This project provides production-ready Model Context Protocol (MCP) server capabilities with enterprise-grade features for intelligent development workflows.

We welcome contributions from the community and appreciate your help in making this project better.

## Table of Contents

- [Development Setup](#development-setup)
- [Code Style](#code-style)
- [Testing Requirements](#testing-requirements)
- [Pull Request Process](#pull-request-process)
- [Issue Reporting](#issue-reporting)
- [Code of Conduct](#code-of-conduct)

## Development Setup

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js**: Version 22.0 or higher (native ESM support required)
- **npm**: Comes with Node.js
- **SQLite**: Version 3.35+ (for FTS5 full-text search support)
- **NixOS**: Recommended for full feature set, but not strictly required
- **Git**: For version control

Optional but recommended:
- **llama.cpp server**: For semantic caching with embeddings

### Clone and Install

```bash
# Clone the repository
git clone https://github.com/marcosfpina/securellm-mcp.git
cd securellm-mcp

# Install dependencies
npm install

# Build the project
npm run build
```

### Environment Setup

Create a `.env` file in the project root. Use `.env.example` as a template:

```bash
cp .env.example .env
```

Edit `.env` with your configuration. At minimum, set:

```bash
PROJECT_ROOT=/path/to/your/project
ENABLE_KNOWLEDGE=true
LOG_LEVEL=debug
```

For full functionality, configure API keys and optional services as needed.

### Verify Installation

```bash
# Run tests to verify everything is working
npm test

# Start the server
node build/src/index.js
```

## Code Style

We maintain high code quality standards to ensure the codebase remains maintainable and production-ready.

### TypeScript Guidelines

- **Strict Mode Enabled**: All TypeScript code must pass strict type checking
- **Type Definitions**: Prefer explicit types over `any`; use proper type definitions in `src/types/`
- **Zod Validation**: Use Zod for runtime validation and schema definitions
- **ESM Imports**: Always use `.js` extensions in import statements (TypeScript ESM requirement)

### Code Organization

Follow the existing project structure:

```
src/
├── middleware/      # Rate limiting, caching, circuit breakers
├── tools/           # MCP tool implementations
├── types/           # TypeScript type definitions
├── reasoning/       # Hybrid reasoning system
├── knowledge/       # Knowledge management
├── utils/           # Utility functions
└── index.ts         # Main entry point
```

### Naming Conventions

- **Files**: `kebab-case` for file names (e.g., `semantic-cache.ts`)
- **Classes**: `PascalCase` (e.g., `SemanticCache`)
- **Functions/Variables**: `camelCase` (e.g., `createSession`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `DEFAULT_CACHE_TTL`)
- **Types/Interfaces**: `PascalCase` (e.g., `KnowledgeEntry`)

### Linting and Formatting

Before committing, ensure your code passes linting and formatting checks:

```bash
# Run ESLint
npm run lint

# Fix ESLint issues automatically
npm run lint:fix

# Check Prettier formatting
npm run format:check

# Apply Prettier formatting
npm run format
```

## Testing Requirements

We aim for >70% test coverage to ensure reliability and prevent regressions.

### Writing Tests

- **Location**: Place test files in the `tests/` directory
- **Naming**: Use `.test.ts` extension (e.g., `semantic-cache.test.ts`)
- **Framework**: Use Node.js built-in test runner with `node:test`
- **Assertions**: Use `node:assert` for assertions

### Test Structure

Follow this pattern for consistency:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { YourClass } from "../src/path/to/class.js";

describe("YourClass", () => {
  describe("methodName", () => {
    it("should handle normal case", () => {
      // Arrange
      const instance = new YourClass(config);
      const input = { /* test data */ };

      // Act
      const result = instance.methodName(input);

      // Assert
      assert.strictEqual(result.success, true);
    });

    it("should handle error conditions", () => {
      // Test error paths
    });
  });
});
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (during development)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

### Coverage Requirements

- New features must include tests
- Bug fixes should include regression tests
- Aim to maintain or improve overall coverage
- Focus on testing critical paths and edge cases

## Pull Request Process

### Before Submitting

1. **Fork the Repository**: Create your own fork on GitHub
2. **Create a Feature Branch**: Use a descriptive name
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/bug-description
   ```

3. **Make Your Changes**: Follow the code style guidelines
4. **Write Tests**: Add tests for new functionality
5. **Run Checks**: Ensure all checks pass
   ```bash
   npm run lint
   npm run format:check
   npm test
   npm run build
   ```

6. **Commit with Clear Messages**: Use descriptive commit messages
   ```bash
   git commit -m "feat: add new caching strategy for embeddings"
   git commit -m "fix: resolve race condition in rate limiter"
   git commit -m "docs: update installation instructions"
   ```

### Commit Message Format

We follow conventional commits:

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `test:` - Test additions or modifications
- `refactor:` - Code refactoring
- `perf:` - Performance improvements
- `chore:` - Build process or tooling changes

### Submitting the Pull Request

1. **Push to Your Fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Open a Pull Request**: Navigate to the repository on GitHub and click "New Pull Request"

3. **Fill Out the Template**: Provide a clear description including:
   - What changes were made
   - Why the changes are needed
   - How to test the changes
   - Related issue numbers (if applicable)

4. **Wait for Review**: Maintainers will review your PR and may request changes

5. **Address Feedback**: Make requested changes and push additional commits

6. **Merge**: Once approved, your PR will be merged

### PR Guidelines

- Keep PRs focused on a single feature or fix
- Update documentation for user-facing changes
- Ensure CI/CD checks pass
- Respond to review comments promptly
- Be open to feedback and discussion

## Issue Reporting

### Before Opening an Issue

- Search existing issues to avoid duplicates
- Check the documentation for answers
- Try the latest version to see if the issue is resolved

### Creating a Good Issue

Include the following information:

1. **Clear Title**: Descriptive and concise

2. **Environment Details**:
   ```
   - Node.js version: (e.g., 22.1.0)
   - npm version: (e.g., 10.3.0)
   - OS: (e.g., NixOS 24.05, Ubuntu 22.04, macOS 14)
   - Package version: (e.g., 2.0.0)
   ```

3. **Steps to Reproduce**: Detailed steps to reproduce the issue

4. **Expected Behavior**: What you expected to happen

5. **Actual Behavior**: What actually happened

6. **Relevant Logs**: Include error messages or logs (sanitize sensitive data)

7. **Minimal Reproduction**: If possible, provide minimal code to reproduce

### Issue Labels

- `bug`: Something isn't working
- `enhancement`: New feature or request
- `documentation`: Documentation improvements
- `good first issue`: Good for newcomers
- `help wanted`: Extra attention is needed

## Code of Conduct

### Our Standards

- Be respectful and professional in all interactions
- Welcome diverse perspectives and experiences
- Accept constructive criticism gracefully
- Focus on what's best for the project and community
- Show empathy towards other contributors

### Unacceptable Behavior

- Harassment, trolling, or discriminatory comments
- Personal attacks or political arguments
- Publishing others' private information
- Any conduct that could reasonably be considered inappropriate

### Enforcement

Project maintainers have the right and responsibility to remove, edit, or reject comments, commits, code, issues, and other contributions that don't align with this Code of Conduct.

## Questions?

If you have questions about contributing, feel free to:

- Open a discussion on GitHub
- Open an issue with the `question` label
- Review existing documentation in the `docs/` directory

## Recognition

Contributors who make significant improvements will be acknowledged in the project's release notes and documentation.

Thank you for contributing to SecureLLM MCP! Your efforts help make this project better for everyone.
