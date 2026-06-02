# ADR-0001: Adopt Effect-TS + Zod as Core Architectural Foundation

| Field | Value |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-06-02 |
| **Classification** | Critical |
| **Project** | SecureLLM MCP |
| **Author** | marcosfpina |

---

## Context

SecureLLM MCP currently suffers from four architectural problems that manifest as 2,800+ ESLint warnings and fragile runtime behavior:

1. **SQLite boundary leaks `any`** — `src/knowledge/database.ts` (985 lines) uses `stmt.all() as any[]` / `stmt.get() as any` in ~30 methods. Every consumer downstream inherits untyped data, generating ~60% of all `no-unsafe-*` warnings.

2. **Duplicate type definitions** — The same entity (Session, KnowledgeEntry, KnowledgeSummary) has an interface in `src/types/` AND a Zod schema in `src/knowledge/schemas.ts`. These can diverge silently (e.g., `metadata: Record<string, unknown>` vs `metadata: z.string()` for JSON-encoded columns).

3. **God Class** — `src/index.ts` (1,029 lines) handles initialization, tool dispatch, knowledge CRUD, rate limiter status, resource handlers, and transport setup in a single class. Dependencies are accessed via `this.*`, making testing and refactoring brittle.

4. **Untyped error handling** — `catch (err: any)` throughout the codebase means error handling is best-effort with no compile-time guarantees about which errors can occur where.

The project needs an architectural foundation that addresses all four problems at the root, not by suppressing lint warnings, but by making incorrect code impossible to write.

---

## Decision

**Adopt Effect-TS + Zod as the core architectural foundation for all new code, and incrementally migrate existing modules.**

Effect-TS provides three primitives that directly solve our problems:

| Primitive | What it solves |
|---|---|
| `Effect<Requirements, Error, Success>` | Typed dependency injection, typed errors, typed success |
| `Layer<Requirements, Error, Service>` | Composable dependency wiring (replaces `this.*` in God Class) |
| `Schema` (interop with Zod) | Single source of truth for validation + types |

Zod remains the validation/parsing layer. Effect-TS `Schema` can derive from Zod or be used directly with identical semantics.

### Core pattern

Every operation becomes a **pure description** — a value that declares exactly what it needs, what can go wrong, and what it produces:

```typescript
// BEFORE: Class method, implicit deps, untyped errors
class SQLiteKnowledgeDatabase {
  private db: Database;
  async getSession(id: string): Promise<Session | null> {
    const row = stmt.get(id) as any;  // any leaks into system
  }
}

// AFTER: Pure function, explicit deps, typed errors
const getSession = (
  id: string
): Effect<SqliteService, SessionNotFound | CorruptedDataError, Session> =>
  pipe(
    SqliteService.query(SELECT_SESSION, { id }),
    Effect.flatMap(SessionRowSchema.parse),  // Zod at boundary
    Effect.mapError(/* typed error mapping */),
  );
```

---

## Architecture

### Service Layer

Each subsystem becomes an Effect-TS `Tag` — a typed interface with a concrete `Layer` implementation:

```
src/
  services/
    infrastructure/
      sqlite.ts         ← SqliteService (Tag + Layer)
      nix.ts            ← NixService
      ssh.ts            ← SshService
      
    knowledge/
      session-service.ts    ← Depends on SqliteService
      entry-service.ts
      compaction-service.ts
      
    middleware/
      rate-limiter.ts       ← RateLimiterService
      semantic-cache.ts     ← SemanticCacheService
      metrics.ts            ← MetricsService
      
    tools/
      nix-daemon.ts         ← Pure handler: (input) => Effect<Deps, Error, Output>
      ssh-execute.ts
      knowledge.ts
```

### Tool Handler Pattern

Every MCP tool becomes a pipeline:

```typescript
export const handleNixDaemon = (input: NixDaemonInput) =>
  pipe(
    Schema.decode(NixDaemonInput)(input),     // 1. Validate
    RateLimiter.acquire("nix-daemon"),        // 2. Acquire semaphore
    Effect.flatMap(() => NixService.gc(opts)),// 3. Execute
    ResponseCompactor.compact,                // 4. Compact response
    Effect.tap(Metrics.recordSuccess),        // 5. Record metrics
    Effect.catchTags({                        // 6. Typed error handling
      NixCommandFailed: (e) => Effect.succeed({ error: e.stderr }),
      RateLimitExceeded: (e) => Effect.succeed({ error: `retry after ${e.retryAfter}s` }),
    }),
    Effect.timeout("30 seconds"),             // 7. Timeout
  );
```

### Server Bootstrap (replaces God Class)

```typescript
// server/main.ts
const AppLayer = Layer.mergeAll(
  SqliteServiceLive,
  NixServiceLive,
  SessionServiceLive,     // depends on SqliteService — resolved automatically
  CompactionServiceLive,
  RateLimiterServiceLive,
);

const runtime = ManagedRuntime.make(AppLayer);

// MCP server only wires handlers — no logic
server.tool("nix_daemon", schema, (args) =>
  runtime.runPromise(handleNixDaemon(args))
);
```

### Error Hierarchy

Every error domain gets typed:

```typescript
// services/knowledge/errors.ts
export class SessionNotFound extends TaggedError("SessionNotFound")<{
  id: string;
}>() {}

export class CorruptedDataError extends TaggedError("CorruptedDataError")<{
  table: string;
  cause: unknown;
}>() {}

// Consumers know EXACTLY what to handle:
Effect.catchTags({
  SessionNotFound: (e) => /* must handle */,
  CorruptedDataError: (e) => /* must handle */,
  // SqliteError NOT listed → cannot occur here → compile error if you try
});
```

---

## Migration Strategy

### Phase 1: Foundation (Week 1-2)
- Add `effect` and `@effect/schema` as dependencies
- Create `SqliteService` (Tag + Live Layer wrapping better-sqlite3)
- Create `SessionService` as proof-of-concept
- Define error hierarchy (`src/services/errors.ts`)
- Migrate ONE tool (e.g., `nix-daemon`) to demonstrate the pattern

### Phase 2: Knowledge Module (Week 3-4)
- Migrate all knowledge services: Session, Entry, Summary, Tiers, Compaction
- Replace `SQLiteKnowledgeDatabase` (985 lines) with focused services (~100-150 lines each)
- Run existing tests against new services via `Layer.succeed()` for test doubles

### Phase 3: Tool Migration (Week 5-6)
- Migrate remaining tools one by one
- Old handlers coexist with new during transition (wrap legacy with `Effect.tryPromise`)
- Remove `as any` / `as unknown as` casts as tools adopt Zod-in-pipeline

### Phase 4: Cleanup (Week 7)
- Extract remaining responsibilities from `index.ts`
- Remove deprecated `catch (err: any)` patterns
- Run full lint: target zero `no-unsafe-*` warnings

### Interop during migration

Effect-TS composes with Promise via `Effect.tryPromise`, so old and new code coexist:

```typescript
// Wrapping a legacy function
const legacyGetSession = (id: string): Effect<never, Error, Session | null> =>
  Effect.tryPromise(() => oldDb.getSession(id));
```

---

## Consequences

### Positive

| Consequence | Impact |
|---|---|
| **Zero `any` leakage** | Zod parses at the SQLite boundary. Consumers receive fully typed data. Eliminates ~1,500 `no-unsafe-*` warnings at the root. |
| **Single source of truth** | Zod schemas replace duplicate interfaces in `src/types/`. `type X = z.infer<typeof XSchema>` is always correct. |
| **Explicit dependencies** | Every function declares its deps in its type signature. No hidden `this.*` access. Test by injecting `Layer.succeed(TestService)`. |
| **Typed errors** | `Effect.catchTags({ A, B })` — compiler verifies you handle every possible error path. |
| **Composable infrastructure** | `Effect.timeout`, `Effect.retry`, `Effect.race`, `Effect.acquireRelease` are library primitives — no bespoke implementations. |
| **Incremental migration** | `Effect.tryPromise` wraps existing Promise-based code. No big-bang rewrite required. |

### Negative

| Consequence | Mitigation |
|---|---|
| **Learning curve** | Effect-TS concepts (Effect, Layer, Fiber, Scope) require ramp-up. Mitigated by phase 1 proof-of-concept and pair programming. |
| **New dependency** | `effect` package adds to bundle. Mitigated by tree-shaking: unused combinators are eliminated. |
| **Debugging complexity** | Stack traces in Effect pipelines are different from Promise chains. Mitigated by Effect's built-in tracing (`Effect.withLogSpan`). |
| **Team adoption** | Solo developer currently; no team coordination overhead. |

### Neutral (worth noting)

- Effect-TS uses its own `Schema` module that can interoperate with Zod. The project already uses Zod heavily; continuing with Zod is fine — Effect's `Schema` can wrap Zod schemas when needed.
- The `Layer` system replaces manual dependency wiring. This is more structured but requires a mental model shift from OOP classes to functional composition.

---

## Alternatives Considered

### A: Schema-First + Repository Pattern (no Effect)
- **Pros**: Incremental, no new dependency, familiar patterns
- **Cons**: Doesn't solve typed errors or explicit dependency injection; still relies on classes and `catch (err: any)`

### B: Hexagonal Architecture (Ports & Adapters)
- **Pros**: Clean separation of domain/infrastructure, testable
- **Cons**: Manual dependency wiring; no typed errors; still uses Promise with `catch (err: any)`

### C: Status quo (fix lint warnings individually)
- **Pros**: No risk, no learning curve
- **Cons**: Addresses symptoms, not root causes. 2,800 warnings would come back with any new code.

### D: Effect-TS + Zod (chosen)
- **Pros**: Typed dependencies, typed errors, composable, industry-leading TS architecture
- **Cons**: Learning curve, new dependency, different mental model

---

## References

- [Effect-TS Documentation](https://effect.website)
- [Effect-TS: Why Effect](https://effect.website/docs/why-effect)
- [Effect + Schema Guide](https://effect.website/docs/schema/introduction)
- [Zod Documentation](https://zod.dev)
- [Tagged Errors Pattern](https://effect.website/docs/guides/error-management)
- [Layer-based Dependency Injection](https://effect.website/docs/guides/context-management)

### Prior art in production
- Effect-TS is used by companies including **Inato**, **Evryg**, and **Effectful Technologies** in production systems
- The pattern of `Effect<Requirements, Error, Success>` is equivalent to ZIO (Scala) and Rust's `Result` type — both battle-tested in large-scale systems

---

## Open Questions

1. **Zod vs @effect/schema**: Should we use Effect's built-in Schema module (which has Zod-like API) or keep Zod and wrap? Recommendation: start with Zod (already in project) and migrate to `@effect/schema` incrementally if needed.

2. **Module boundaries**: Should each service be a separate npm package or stay in `src/services/`? Recommendation: monolith-first with clear directory boundaries; extract packages only when needed.

3. **Test strategy**: Do we keep the existing Vitest/Jest tests or adopt Effect's built-in test harness (`@effect/test`)? Recommendation: keep existing test runner, use `TestLayer` pattern for dependency injection in tests.

---

## Decision Log

| Date | Decision |
|---|---|
| 2026-06-02 | ADR proposed |
| - | Awaiting acceptance |
