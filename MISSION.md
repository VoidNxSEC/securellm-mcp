# Spooknix MCP Gateway — instructions

## Contexto

Existe um MCP server interno (~87 tools) que hoje expõe surface grande demais
pra agentes Claude Code rodando em sandbox remoto (Claude Code na web).

Quando o agente termina trabalho no sandbox, ele não consegue empurrar pro
GitHub porque o sandbox não tem credenciais. Solução: adicionar um **gateway
de 3 tools** no MCP server existente, que recebe pedidos do agente, valida
política, e executa contra o GitHub usando credenciais que ficam **só do
lado do servidor**.

Esse documento descreve o que adicionar. Não reescreve o MCP server inteiro.

## Não-objetivos (explícito)

- NÃO expor as 87 tools existentes pra agentes externos. O gateway é um
  conjunto novo, separado, com namespace próprio (sugestão: `gateway_*`).
- NÃO implementar adr-ledger completo agora. O gateway é o ponto de
  registro **futuro** dele — basta deixar hook pronto.
- NÃO inventar formato proprietário de log. JSONL append-only resolve.
- NÃO suportar force-push, branch delete, repo create. Tools de leitura
  podem existir, mas verbos destrutivos ficam fora.

## Tools a adicionar

### 1. `gateway_push_branch`

**Assinatura:**

```
gateway_push_branch(
    repo: str,           # ex: "VoidNxSEC/spooknix"
    branch: str,         # ex: "feat/state-of-the-art-audio"
    rationale: str,      # obrigatório, não-vazio, mínimo 20 chars
    base: str = "main",  # opcional, branch base esperado
) -> { "pushed": bool, "sha": str, "url": str }
```

**Comportamento:**

1. Validar `repo` está na allowlist (config). Se não, recusar com erro claro.
2. Validar `rationale.strip()` tem >= 20 chars. Recusar se vazio/genérico.
3. Verificar que a branch existe no working tree local do gateway (presume
   que o agente já fez `git clone` + commits localmente OU usa um modelo
   de "upload patch" — ver seção Transport abaixo).
4. Executar `git push origin <branch>` usando credencial server-side.
5. Registrar evento no audit log (JSONL).
6. Retornar SHA do HEAD da branch e URL pública.

### 2. `gateway_create_pr`

**Assinatura:**

```
gateway_create_pr(
    repo: str,
    head: str,           # branch
    title: str,
    body: str,
    rationale: str,      # obrigatório, mínimo 20 chars
    base: str = "main",
    draft: bool = False,
) -> { "pr_number": int, "url": str }
```

**Comportamento:**

1. Allowlist check no `repo`.
2. Validar `rationale`.
3. Validar `title` não-vazio, `body` >= 50 chars (força contexto).
4. Chamar `gh pr create` ou API REST do GitHub.
5. Registrar evento.
6. Retornar número do PR e URL.

### 3. `gateway_comment_pr`

**Assinatura:**

```
gateway_comment_pr(
    repo: str,
    pr_number: int,
    body: str,
    rationale: str,
) -> { "comment_id": int }
```

**Comportamento:** trivial — allowlist, validate, post, log.

## Audit log

**Path:** `${GATEWAY_LOG_DIR:-~/.local/share/voidnx-gateway}/events.jsonl`

**Formato (uma linha = um evento, append-only):**

```json
{
  "ts": "2026-05-14T22:15:33Z",
  "agent_id": "claude-code-web:session-abc123",
  "tool": "gateway_push_branch",
  "args": { "repo": "VoidNxSEC/spooknix", "branch": "feat/...", "base": "main" },
  "rationale": "Push branch with 4 commits implementing sprints 5-8 ...",
  "result": "ok",
  "github_response": { "sha": "546cca9...", "url": "https://..." }
}
```

**Importante:** o `agent_id` vem do contexto do MCP transport (cabeçalho
de autenticação, ID de sessão, etc.). Sem `agent_id` válido, recusar.

Esse log é a **semente do adr-ledger**. Mantém formato estável desde dia 1
pra não precisar migrar depois.

## Config

Arquivo de config (YAML/TOML, gosto pessoal), exemplo:

```yaml
gateway:
  allowlist:
    - VoidNxSEC/spooknix
    - VoidNxSEC/adr-ledger
  auth:
    backend: pat # ou "github_app" no futuro
    pat_env: GITHUB_PAT # nome da env var, NÃO o valor
  validation:
    min_rationale_chars: 20
    min_pr_body_chars: 50
  audit:
    log_dir: ~/.local/share/voidnx-gateway
```

**Segurança:**

- O PAT NUNCA aparece em log, retorno de tool, mensagem de erro.
- PAT deve ser fine-grained, escopo limitado aos repos da allowlist,
  permissões `contents:write` + `pull_requests:write` apenas.
- O gateway recusa boot se a config aponta PAT_ENV inexistente.

## Transport

Duas opções, escolhe a que encaixa no MCP server atual:

**Opção A — Gateway clona/segura o repo:**

- Agente externo só manda `branch` e `rationale`.
- Gateway tem o repo clonado localmente; agente roda dentro de uma
  sessão MCP que tem acesso a tools de manipular esse clone.
- Push usa o clone local.
- Mais simples, mas o gateway vira stateful.

**Opção B — Agente envia patch:**

- Agente roda no sandbox dele com clone próprio.
- `gateway_push_branch` recebe parâmetro extra `patch: str` (saída de
  `git format-patch` ou `git bundle`).
- Gateway aplica o patch num clone efêmero e empurra.
- Stateless, mais robusto, melhor pra escalar.

**Recomendação:** Opção B. Stateless, paralelizável, e o patch vira
parte natural do registro de auditoria.

## Testes mínimos antes de marcar como pronto

1. `gateway_push_branch` recusa com erro 400 quando `rationale=""`.
2. `gateway_push_branch` recusa quando `repo` está fora da allowlist.
3. `gateway_push_branch` empurra com sucesso quando args estão OK
   (teste pode usar repo de sandbox, não o prod).
4. Cada chamada bem-sucedida gera linha JSONL válida no log.
5. PAT nunca aparece em nenhum retorno, log ou stacktrace (grep no
   output de teste).
6. Boot do gateway falha se PAT env var não existir.

## Migração futura para adr-ledger

Quando o adr-ledger ficar maduro, o gateway só precisa de UMA mudança:
substituir a chamada que escreve em `events.jsonl` por uma chamada
que escreve no ledger. O formato do evento já está compatível.

Identidade do agente, hoje provavelmente derivada do header MCP, vai
evoluir pra chave assinada do agente. Mas a API exposta pra agentes
(as 3 tools) **não muda**. Eles continuam mandando `rationale` em texto;
o gateway é que sabe traduzir isso pra entrada de ledger.

## Resumo executivo (TL;DR)

Adicionar 3 tools no MCP server existente: `gateway_push_branch`,
`gateway_create_pr`, `gateway_comment_pr`. Cada uma exige `rationale`.
Allowlist de repos. Audit log JSONL append-only. PAT fine-grained no
servidor, agente nunca vê. Opção B (patch-based) recomendada.
~1 tarde de trabalho, e desbloqueia agentes Claude Code da web sem
expor credencial alguma.
