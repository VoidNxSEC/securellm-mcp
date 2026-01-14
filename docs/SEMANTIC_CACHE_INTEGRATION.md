# Semantic Cache Integration Guide

**File**: `src/index.ts`
**Purpose**: Integrate Semantic Cache into the MCP server tool execution flow

---

## Changes Required

### 1. Add Import at Top of File

```typescript
// After existing imports around line 30
import { SemanticCache } from "./middleware/semantic-cache.js";
import * as path from "path";
```

### 2. Add Property to SecureLLMBridgeMCPServer Class

```typescript
// Around line 127, add to class properties:
class SecureLLMBridgeMCPServer {
  private server: Server;
  private db: KnowledgeDatabase | null = null;
  private guideManager: GuideManager;
  private rateLimiter: SmartRateLimiter;
  private projectWatcher: ProjectWatcher | null = null;
  private packageDiagnose!: PackageDiagnoseTool;
  private packageDownload!: PackageDownloadTool;
  private packageConfigure!: PackageConfigureTool;
  private projectRoot: string = PROJECT_ROOT;
  private hostname: string = "default";
  private semanticCache: SemanticCache | null = null; // ← ADD THIS
```

### 3. Initialize Semantic Cache in initialize() Method

```typescript
// Around line 236, after knowledge DB initialization:
async initialize(): Promise<void> {
  try {
    // ... existing code ...

    // Initialize knowledge database if enabled
    if (ENABLE_KNOWLEDGE) {
      this.initKnowledge();
    }

    // Initialize Semantic Cache (NEW)
    this.initSemanticCache();

    logger.info("MCP Server initialization complete");
  } catch (error) {
    logger.fatal({ err: error }, "Failed to initialize MCP server");
    throw error;
  }
}
```

### 4. Add initSemanticCache() Method

```typescript
// After initKnowledge() method around line 259:
private initSemanticCache() {
  try {
    const cacheDbPath = process.env.SEMANTIC_CACHE_DB_PATH ||
      path.join(
        process.env.HOME || process.env.USERPROFILE || ".",
        ".local/share/securellm/semantic_cache.db"
      );

    this.semanticCache = new SemanticCache(cacheDbPath, {
      enabled: process.env.ENABLE_SEMANTIC_CACHE !== 'false',
      similarityThreshold: parseFloat(process.env.SEMANTIC_CACHE_THRESHOLD || '0.85'),
      ttlSeconds: parseInt(process.env.SEMANTIC_CACHE_TTL || '3600', 10),
      llamaCppUrl: process.env.LLAMA_CPP_URL || 'http://localhost:8080',
    });

    logger.info({ dbPath: cacheDbPath }, "Semantic cache initialized");

    // Start periodic cleanup (every 10 minutes)
    setInterval(() => {
      if (this.semanticCache) {
        const deleted = this.semanticCache.cleanExpired();
        if (deleted > 0) {
          logger.info({ deleted }, "Cleaned expired semantic cache entries");
        }
      }
    }, 10 * 60 * 1000);

  } catch (error) {
    logger.error({ err: error }, "Failed to initialize semantic cache");
    this.semanticCache = null;
  }
}
```

### 5. Wrap CallToolRequestSchema Handler

```typescript
// Replace the existing handler around line 533 with this wrapped version:
this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    // SEMANTIC CACHE: Check cache before executing tool
    if (this.semanticCache) {
      const cacheKey = JSON.stringify({ name, args });
      const cached = await this.semanticCache.lookup({
        toolName: name,
        queryText: cacheKey,
        toolArgs: args,
      });

      if (cached) {
        // Return cached response
        return cached;
      }
    }

    // Execute tool (existing switch statement)
    let result;
    switch (name) {
      case "provider_test":
        result = await this.handleProviderTest(args as unknown as ProviderTestArgs);
        break;
      case "security_audit":
        result = await this.handleSecurityAudit(args as unknown as SecurityAuditArgs);
        break;
      case "rate_limit_check":
        result = await this.handleRateLimitCheck(args as unknown as RateLimitCheckArgs);
        break;
      case "build_and_test":
        result = await this.handleBuildAndTest(args as unknown as BuildAndTestArgs);
        break;
      case "provider_config_validate":
        result = await this.handleProviderConfigValidate(args as unknown as ProviderConfigValidateArgs);
        break;
      case "crypto_key_generate":
        result = await this.handleCryptoKeyGenerate(args as unknown as CryptoKeyGenerateArgs);
        break;

      // Knowledge handlers (if DB enabled)
      case "create_session":
      case "save_knowledge":
      case "search_knowledge":
      case "load_session":
      case "list_sessions":
      case "get_recent_knowledge":
        if (!this.db) {
          throw new McpError(ErrorCode.InvalidRequest, "Knowledge database not enabled");
        }
        result = await this.handleKnowledgeTool(name, args);
        break;

      // Package management handlers
      case "package_diagnose":
        result = await this.packageDiagnose.execute(args);
        break;
      case "package_download":
        result = await this.packageDownload.execute(args);
        break;
      case "package_configure":
        result = await this.packageConfigure.execute(args);
        break;

      // Emergency Framework handlers
      case "emergency_status":
        result = await handleEmergencyStatus();
        break;
      case "emergency_abort":
        result = await handleEmergencyAbort(args as any);
        break;
      case "emergency_cooldown":
        result = await handleEmergencyCooldown(args as any);
        break;
      case "emergency_nuke":
        result = await handleEmergencyNuke();
        break;
      case "emergency_swap":
        result = await handleEmergencySwap();
        break;
      case "system_health_check":
        result = await handleSystemHealthCheck();
        break;
      case "safe_rebuild_check":
        result = await handleSafeRebuildCheck();
        break;

      // Laptop Defense handlers
      case "thermal_check":
        result = await handleThermalCheck();
        break;
      case "rebuild_safety_check":
        result = await handleRebuildSafetyCheck();
        break;
      case "thermal_forensics":
        result = await handleThermalForensics(args as any);
        break;
      case "thermal_warroom":
        result = await handleThermalWarroom();
        break;
      case "laptop_verdict":
        result = await handleLaptopVerdict();
        break;
      case "full_investigation":
        result = await handleFullInvestigation();
        break;
      case "force_cooldown":
        result = await this.handleForceCooldown();
        break;
      case "reset_performance":
        result = await this.handleResetPerformance();
        break;

      // Web Search handlers
      case "web_search":
        result = await this.handleWebSearch(args);
        break;
      case "nix_search":
        result = await this.handleNixSearch(args);
        break;
      case "github_search":
        result = await this.handleGithubSearch(args);
        break;
      case "tech_news_search":
        result = await this.handleTechNewsSearch(args);
        break;
      case "nixos_discourse_search":
        result = await this.handleDiscourseSearch(args);
        break;
      case "stackoverflow_search":
        result = await this.handleStackOverflowSearch(args);
        break;

      // Research Agent handler
      case "research_agent":
        result = await handleResearchAgent(args as any);
        break;

      // Codebase Analysis handlers
      case "analyze_complexity":
        result = await analyzeComplexity(args as any);
        break;
      case "find_dead_code":
        result = await findDeadCode(args as any);
        break;

      // Secure Execution handler
      case "execute_in_sandbox":
        result = await handleExecuteInSandbox(args as any);
        break;

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }

    // SEMANTIC CACHE: Store result for future lookups
    if (this.semanticCache && result) {
      const cacheKey = JSON.stringify({ name, args });
      await this.semanticCache.store({
        toolName: name,
        queryText: cacheKey,
        toolArgs: args,
        response: result,
      });
    }

    return result;

  } catch (error) {
    if (error instanceof McpError) throw error;
    throw new McpError(
      ErrorCode.InternalError,
      `Tool execution failed: ${error}`
    );
  }
});
```

### 6. Add Semantic Cache Resource

```typescript
// In ListResourcesRequestSchema handler, around line 651, add new resource:
this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "config://current",
      name: "Current Configuration",
      description: "Current SecureLLM Bridge configuration",
      mimeType: "application/toml",
    },
    {
      uri: "logs://audit",
      name: "Audit Logs",
      description: "Recent audit log entries",
      mimeType: "application/json",
    },
    {
      uri: "metrics://usage",
      name: "Usage Metrics",
      description: "Provider usage statistics",
      mimeType: "application/json",
    },
    {
      uri: "metrics://prometheus",
      name: "Prometheus Metrics",
      description: "System metrics in Prometheus text format",
      mimeType: "text/plain",
    },
    {
      uri: "metrics://semantic-cache", // ← ADD THIS
      name: "Semantic Cache Metrics",
      description: "Semantic cache performance statistics",
      mimeType: "application/json",
    },
    {
      uri: "docs://api",
      name: "API Documentation",
      description: "API documentation and examples",
      mimeType: "text/markdown",
    },
  ],
}));
```

### 7. Add Semantic Cache Resource Handler

```typescript
// In ReadResourceRequestSchema handler, add new case around line 745:
case "metrics://semantic-cache":
  return {
    contents: [
      {
        uri: "metrics://semantic-cache",
        mimeType: "application/json",
        text: JSON.stringify(
          this.semanticCache?.getStats() || { error: "Semantic cache not initialized" },
          null,
          2
        ),
      },
    ],
  };
```

### 8. Update SIGINT Handler

```typescript
// Around line 162, update shutdown handler:
process.on("SIGINT", async () => {
  logger.info("Received SIGINT, shutting down gracefully");
  if (this.db) {
    this.db.close();
  }
  if (this.semanticCache) { // ← ADD THIS
    this.semanticCache.close();
  }
  await this.server.close();
  process.exit(0);
});
```

---

## Environment Variables

Add to `.env` file:

```bash
# Semantic Cache Configuration
ENABLE_SEMANTIC_CACHE=true
SEMANTIC_CACHE_THRESHOLD=0.85
SEMANTIC_CACHE_TTL=3600
SEMANTIC_CACHE_MAX_ENTRIES=1000
SEMANTIC_CACHE_MIN_QUERY_LENGTH=10
SEMANTIC_CACHE_DB_PATH=~/.local/share/securellm/semantic_cache.db
LLAMA_CPP_URL=http://localhost:8080
EMBEDDING_TIMEOUT=5000
SEMANTIC_CACHE_EXCLUDE_TOOLS=
```

---

## Testing

After integration, test with:

```bash
# 1. Start server
npm run build && node dist/index.js

# 2. Call a tool twice with similar queries
# First call (cache MISS)
{"jsonrpc":"2.0","method":"tools/call","params":{"name":"thermal_check","arguments":{}},"id":1}

# Second call (cache HIT)
{"jsonrpc":"2.0","method":"tools/call","params":{"name":"thermal_check","arguments":{}},"id":2}

# 3. Check cache metrics
{"jsonrpc":"2.0","method":"resources/read","params":{"uri":"metrics://semantic-cache"},"id":3}
```

Expected output:
```json
{
  "totalQueries": 2,
  "cacheHits": 1,
  "cacheMisses": 1,
  "hitRate": 50,
  "tokensSaved": 100,
  "avgSimilarityOnHit": 1.0,
  "entriesCount": 1
}
```

---

## Verification Checklist

- [ ] Semantic cache imports added
- [ ] `semanticCache` property added to class
- [ ] `initSemanticCache()` method created
- [ ] Semantic cache initialized in `initialize()`
- [ ] Tool call handler wrapped with cache lookup/store
- [ ] Semantic cache resource added to resource list
- [ ] Semantic cache metrics handler added
- [ ] Cleanup scheduled (10 min intervals)
- [ ] SIGINT handler updated
- [ ] Environment variables configured
- [ ] Server starts without errors
- [ ] Cache hits are logged
- [ ] Metrics endpoint returns stats

---

**Status**: Integration ready for implementation ✅
