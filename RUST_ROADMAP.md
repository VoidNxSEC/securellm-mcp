# Rust Migration Roadmap — securellm-mcp

> Objetivo: aprender Rust com proficiência real migrando este projeto progressivamente.
> Base atual: 121 arquivos TypeScript, ~35K LOC, 80+ ferramentas MCP.

---

## Filosofia

Não é uma reescrita big-bang. Cada fase entrega valor real e ensina um
conjunto específico de conceitos Rust. O servidor TS continua rodando em
produção enquanto o Rust cresce ao lado.

---

## Fase 0 — Fundação (antes de tocar o projeto)

**Duração estimada**: 2–3 semanas de estudo paralelo ao trabalho.

### O que estudar

| Recurso | Foco |
|---|---|
| [The Rust Book](https://doc.rust-lang.org/book/) caps. 1–10 | Ownership, borrowing, structs, enums, error handling |
| [Rustlings](https://github.com/rust-lang/rustlings) | Exercícios práticos sobre cada conceito |
| [Rust by Example](https://doc.rust-lang.org/rust-by-example/) | Referência rápida |

### Conceitos que você precisa dominar antes da Fase 1

- `ownership`, `move`, `clone`, `Copy`
- `&T` vs `&mut T`, lifetimes básicos
- `Option<T>`, `Result<T, E>`, `?` operator
- `struct`, `impl`, `enum` com dados
- `match`, `if let`, `while let`
- `Vec<T>`, `HashMap<K,V>`, `String` vs `&str`
- `trait` básico, `Display`, `Debug`, `From`/`Into`

### Marco de conclusão

Conseguir implementar uma struct com métodos, error handling com `Result`,
e serialização com `serde` sem consultar a documentação a cada linha.

---

## Fase 1 — Primeiro módulo Rust real

**Conceitos Rust aprendidos**: structs, enums, traits, serde, thiserror, clap/config
**Arquivos TS de referência**: `src/security/input-validators.ts`, `src/security/path-validator.ts`

### Tarefa: portar os validators de segurança

Criar `crates/security/` com:

```
crates/security/
├── Cargo.toml
└── src/
    ├── lib.rs
    ├── input_validators.rs   # equivalente a input-validators.ts
    └── path_validator.rs     # equivalente a path-validator.ts
```

**Por que começar aqui:**
- Sem I/O assíncrono — lógica pura, ideal para aprender
- Os bugs de segurança que já existiam em TS (domain whitelist, path traversal)
  aqui são **impossíveis de expressar errado** — o compilador te ensina
- Boa introdução a `regex`, `thiserror`, e pattern matching

**Conceitos que você vai aprender:**
- Custom error types com `thiserror`
- `regex::Regex` compilado uma vez (`lazy_static` / `std::sync::OnceLock`)
- Validação com `Result` vs panic
- Testes unitários com `#[cfg(test)]`

**Exemplo de como a migração fica:**

```rust
// TS: domain === d || domain.endsWith('.' + d)
pub fn is_allowed_domain(domain: &str, whitelist: &[&str]) -> bool {
    whitelist.iter().any(|&d| {
        domain == d || domain.ends_with(&format!(".{d}"))
    })
}
```

---

## Fase 2 — Tipos, serialização e configuração

**Conceitos Rust aprendidos**: serde, derive macros, enums com payload, config management
**Arquivos TS de referência**: `src/types/`, `src/config/`

### Tarefa: portar o sistema de tipos e config

```
crates/types/
crates/config/
```

- Todos os `interface` e `type` TS viram `struct` / `enum` Rust com `serde`
- `src/config/rate-limits.ts` → `RateLimitConfig` com `serde::Deserialize`
- `src/config/paths.ts` → paths com validação no parse, não no uso

**Conceitos que você vai aprender:**
- `#[derive(Debug, Clone, Serialize, Deserialize)]`
- `serde` com `rename_all`, `skip_serializing_if`, `default`
- `config` crate (equivalente ao dotenv + zod do TS)
- Diferença entre `String` owned e `&str` borrowed em structs

---

## Fase 3 — Concorrência e estado compartilhado

**Conceitos Rust aprendidos**: `Arc`, `Mutex`, `RwLock`, `tokio`, async/await
**Arquivos TS de referência**: `src/middleware/rate-limiter.ts`, `src/middleware/circuit-breaker.ts`, `src/middleware/request-deduplicator.ts`

### Tarefa: portar o middleware layer

```
crates/middleware/
├── src/
│   ├── rate_limiter.rs
│   ├── circuit_breaker.rs
│   └── request_deduplicator.rs
```

**Por que este é o passo natural após tipos:**
- Rate limiter precisa de estado compartilhado → `Arc<Mutex<HashMap<...>>>`
- Circuit breaker precisa de estado com transições → enum de estados + `Arc<RwLock<>>`
- Request deduplicator é concorrência real: `Arc<DashMap<>>` ou `tokio::sync`

**Conceitos que você vai aprender:**
- `Arc<T>` para compartilhar ownership entre threads
- `Mutex<T>` vs `RwLock<T>` — quando usar cada um
- `tokio::sync::Semaphore` para controle de concorrência
- `async fn`, `await`, e o modelo de execução do tokio
- Por que `Send + Sync` importa

**O Float32Array bug que já corrigimos em TS:**
```rust
// Em Rust isso seria um erro de compilação ou seria óbvio:
// Você não pode "interpretar" bytes errados acidentalmente
// sem usar unsafe — o compilador te para
let embeddings: Vec<f32> = bytemuck::cast_slice(&raw_bytes).to_vec();
```

---

## Fase 4 — Persistência e embeddings

**Conceitos Rust aprendidos**: `sqlx`/`rusqlite`, async database, SIMD/buffers
**Arquivos TS de referência**: `src/middleware/semantic-cache.ts`, `src/intelligence/vector-store.ts`, `src/knowledge/database.ts`

### Tarefa: portar o sistema de cache e knowledge base

```
crates/storage/
├── src/
│   ├── semantic_cache.rs
│   ├── vector_store.rs
│   └── knowledge_db.rs
```

**Conceitos que você vai aprender:**
- `rusqlite` para SQLite síncrono ou `sqlx` para async
- `sqlx::migrate!()` para migrations type-safe
- `bytemuck::cast_slice` para reinterpretar bytes como f32 (o bug que corrigimos, agora impossível em Rust safe)
- Cosine similarity com SIMD usando `std::simd` (nightly) ou `nalgebra`
- Connection pooling com `r2d2` ou `sqlx::Pool`

---

## Fase 5 — I/O assíncrono e networking

**Conceitos Rust aprendidos**: `tokio`, `reqwest`, `hickory-dns`, sockets
**Arquivos TS de referência**: `src/tools/web-search.ts`, `src/tools/system/health-check.ts`, ferramentas OSINT

### Tarefa: portar ferramentas de networking

```
crates/net-tools/
├── src/
│   ├── web_search.rs
│   ├── osint_dns.rs
│   ├── osint_portscan.rs
│   └── health_check.rs
```

**Conceitos que você vai aprender:**
- `reqwest` para HTTP client async
- `hickory-dns` (antigo trust-dns) para resolução DNS
- `tokio::net::TcpStream` para port scanning
- Timeouts com `tokio::time::timeout`
- `futures::stream` para fan-out paralelo de queries

---

## Fase 6 — SSH e tunneling

**Conceitos Rust aprendidos**: lifetimes complexos, estado de máquina, FFI-safe abstrações
**Arquivos TS de referência**: `src/tools/ssh/`

### Tarefa: portar as SSH tools

```
crates/ssh-tools/
├── src/
│   ├── connection_manager.rs
│   ├── tunnel_manager.rs
│   ├── jump_host_manager.rs
│   └── session_manager.rs
```

**Conceitos que você vai aprender:**
- `russh` crate para SSH protocol
- State machines com enums tipados (conexão → autenticada → executando)
- Lifetimes em structs que guardam referências a conexões
- `Drop` trait para cleanup garantido de recursos (equivalente ao `DisposableRegistry`)
- Por que Rust é melhor que TS para gerenciar recursos de rede

---

## Fase 7 — O servidor MCP em Rust

**Conceitos Rust aprendidos**: macros, trait objects, arquitetura de sistemas, FFI
**Arquivos TS de referência**: `src/index.ts`, `src/utils/schema-converter.ts`

### Tarefa: o servidor principal

```
crates/mcp-server/
├── src/
│   ├── main.rs
│   ├── server.rs
│   ├── tool_registry.rs
│   └── schema.rs
```

**Opções para o protocolo MCP:**
- [`rmcp`](https://github.com/modelcontextprotocol/rust-sdk) — SDK oficial experimental
- Implementar o protocolo JSON-RPC na mão — melhor aprendizado, total controle

**Conceitos que você vai aprender:**
- `trait` como interface polimórfica (`dyn Tool`)
- `Box<dyn Tool>` para coleções heterogêneas
- Macros procedurais para registro automático de tools
- `serde_json::Value` para JSON dinâmico
- stdin/stdout framing do protocolo MCP

---

## Fase 8 — Integração e binário único

**Tarefa**: juntar todos os crates num binário que substitui o servidor Node.js.

```
securellm-mcp/          ← workspace Cargo.toml
├── crates/
│   ├── security/
│   ├── types/
│   ├── config/
│   ├── middleware/
│   ├── storage/
│   ├── net-tools/
│   ├── ssh-tools/
│   └── mcp-server/     ← main binary
└── src/                ← TS original (vai diminuindo)
```

**Resultado final:**
- Binário estático, sem Node.js runtime
- Distribuível como um único executável
- Memória controlada, sem GC pauses
- Erros de segurança impossíveis de compilar

---

## Referência de crates por domínio

| Domínio | Crate TS equivalente | Crate Rust |
|---|---|---|
| HTTP client | `fetch` / `axios` | `reqwest` |
| Serialização | `zod` / JSON.parse | `serde` + `serde_json` |
| SQLite | `better-sqlite3` | `rusqlite` / `sqlx` |
| SSH | `ssh2` | `russh` |
| Crypto | `crypto` (Node builtin) | `ring` / `ed25519-dalek` |
| DNS | `dns` | `hickory-dns` |
| Error handling | `zod` errors / try-catch | `thiserror` / `anyhow` |
| Logging | `pino` | `tracing` + `tracing-subscriber` |
| Async runtime | Node.js event loop | `tokio` |
| Regex | `RegExp` | `regex` |
| Config/env | `dotenv` + zod | `config` + `dotenvy` |
| Concorrência | Worker threads / Promises | `tokio` + `rayon` |
| SIMD/buffers | `Float32Array` | `bytemuck` + `std::simd` |
| Testes | `node:test` | `#[test]` built-in + `rstest` |

---

## Indicadores de progresso

- [ ] Fase 0 — Rustlings completo, capítulos 1–10 do Book
- [ ] Fase 1 — `crates/security` com 100% dos validators portados e testados
- [ ] Fase 2 — `crates/types` + `crates/config` compilando com serde
- [ ] Fase 3 — `crates/middleware` com rate limiter e circuit breaker funcionais
- [ ] Fase 4 — Cache semântico em Rust com SQLite, embeddings corretos
- [ ] Fase 5 — Ferramentas de rede funcionando assincronamente
- [ ] Fase 6 — SSH tools com session manager persistente
- [ ] Fase 7 — Servidor MCP mínimo respondendo tools
- [ ] Fase 8 — Binário único substituindo o Node.js em produção
