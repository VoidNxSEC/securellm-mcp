# Prompt Caching Guide (Client-Side)

**Cost Savings**: 70-90% reduction in input token costs
**Implementation**: Client-side (Claude Desktop, Cline)
**API**: Anthropic Claude API

---

## 🎯 What is Prompt Caching?

Anthropic's Prompt Caching allows you to cache portions of your prompts (like tool definitions and system messages) so they don't count toward input tokens on subsequent API calls. This is especially powerful for MCP servers with many tools (like SecureLLM-MCP with 40+ tools).

### Cost Breakdown

**Without Prompt Caching**:
```
Tool definitions: ~5,000 tokens
System prompt: ~2,000 tokens
User query + context: ~2,000 tokens
Total input: 9,000 tokens per request

Cost: 9,000 * $3/MTok = $0.027 per request
Monthly (100 req/day): $81
```

**With Prompt Caching**:
```
Tool definitions: ~5,000 tokens (CACHED after first request)
System prompt: ~2,000 tokens (CACHED after first request)
User query + context: ~2,000 tokens (always fresh)
Total input: 2,000 tokens per request

Cache writes: 7,000 tokens * $3.75/MTok = $0.026 (one-time)
Cache reads: 7,000 tokens * $0.30/MTok = $0.002 per request
Fresh tokens: 2,000 tokens * $3/MTok = $0.006 per request
Total per request (after first): $0.008

Monthly (100 req/day): $24
Savings: $57/month (70% reduction)
```

---

## 🔧 How to Enable (Client-Side)

### For Claude Desktop

Claude Desktop **automatically uses prompt caching** for MCP tool definitions! No configuration needed.

However, you can verify it's working by checking the API logs or monitoring your Anthropic dashboard.

### For Cline (VS Code Extension)

Cline also supports prompt caching automatically when using Claude API. Just ensure you're using:
- Claude Sonnet 3.5 or newer
- Anthropic API (not OpenRouter or other proxies)

### For Custom Integrations

If you're building a custom MCP client, add `cache_control` to your tool definitions:

```typescript
const tools = [
  {
    name: "my_tool",
    description: "Tool description",
    inputSchema: { /* ... */ },
    cache_control: { type: "ephemeral" } // ← ADD THIS
  }
];

const systemPrompt = [
  {
    type: "text",
    text: "You are a helpful assistant...",
    cache_control: { type: "ephemeral" } // ← ADD THIS
  }
];

// Send to Anthropic API
const response = await anthropic.messages.create({
  model: "claude-sonnet-4-5-20250929",
  max_tokens: 2048,
  system: systemPrompt,
  tools: tools,
  messages: [
    { role: "user", content: query }
  ]
});
```

---

## 📊 Monitoring Cache Performance

### Anthropic Console

1. Go to [Anthropic Console](https://console.anthropic.com)
2. Navigate to **Usage** → **API Keys**
3. Check **Cache Hits** vs **Cache Writes**

### Expected Metrics

| Metric | Expected Value | What it Means |
|--------|---------------|---------------|
| **Cache Hit Rate** | 70-95% | % of requests using cached content |
| **Cache Write Ratio** | 5-30% | % of requests creating new cache entries |
| **Cost Reduction** | 70-90% | Overall input token cost savings |

### Example Dashboard

```
Cache Performance (Last 7 days)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Requests:        10,000
Cache Hits:             8,200 (82%)
Cache Writes:           1,800 (18%)

Token Savings:
  Cached Tokens:    57,400,000
  Fresh Tokens:     20,000,000
  Total Input:      77,400,000

Cost Breakdown:
  Cache Reads:      $17.22  (57.4M * $0.30/MTok)
  Cache Writes:     $ 6.75  ( 1.8M * $3.75/MTok)
  Fresh Tokens:     $60.00  (20.0M * $3.00/MTok)
  Total:            $83.97

Without Caching:    $232.20 (77.4M * $3.00/MTok)
Savings:            $148.23 (64% reduction)
```

---

## ⚙️ Configuration Options

### Cache TTL (Time to Live)

Anthropic caches content for **5 minutes** by default. This is perfect for:
- Multi-turn conversations (typical session length)
- Rapid tool calls during a task
- Iterative debugging sessions

### What Gets Cached?

✅ **Always Cache**:
- Tool definitions (MCP tools)
- System prompts
- Large context documents
- Retrieved RAG context (if stable)

❌ **Never Cache**:
- User messages (always fresh)
- Dynamic context that changes per request
- Session-specific data

### Best Practices

1. **Order Matters**: Place cacheable content at the **beginning** of your prompt
2. **Stability**: Only cache content that doesn't change frequently
3. **Size**: Cache works best with 1024+ tokens (smaller content has less benefit)
4. **Breakpoints**: Use multiple `cache_control` markers to cache different sections independently

---

## 🔍 Troubleshooting

### Cache Hit Rate < 50%

**Possible Causes**:
- Tool definitions changing between requests
- System prompt being regenerated dynamically
- Session timeout (>5 minutes between requests)
- Using different API keys per request

**Solutions**:
- Ensure tool definitions are static
- Cache system prompts at application startup
- Keep conversation active (<5 min between calls)
- Use consistent API key

### Cache Not Working

**Check**:
1. Using Claude Sonnet 3.5 or newer? (older models don't support caching)
2. Using Anthropic API directly? (not OpenRouter or proxies)
3. Content size > 1024 tokens? (smaller content not cached efficiently)
4. `cache_control` present in request? (required for custom clients)

---

## 🚀 Advanced: Cache Warming

For high-traffic applications, "warm" the cache during startup:

```typescript
// Send a dummy request to populate cache
await anthropic.messages.create({
  model: "claude-sonnet-4-5-20250929",
  max_tokens: 10,
  system: systemPromptWithCacheControl,
  tools: toolsWithCacheControl,
  messages: [
    { role: "user", content: "warmup" }
  ]
});

// Now all subsequent requests will hit the cache
```

---

## 📈 Expected ROI

### Small Deployment (100 requests/day)

| Metric | Without Cache | With Cache | Savings |
|--------|--------------|------------|---------|
| Input Tokens/Request | 9,000 | 2,500 | 72% |
| Cost/Request | $0.027 | $0.008 | 70% |
| Monthly Cost | $81 | $24 | **$57/mo** |
| Annual Savings | - | - | **$684/yr** |

### Medium Deployment (1,000 requests/day)

| Metric | Without Cache | With Cache | Savings |
|--------|--------------|------------|---------|
| Monthly Cost | $810 | $240 | **$570/mo** |
| Annual Savings | - | - | **$6,840/yr** |

### Large Deployment (10,000 requests/day)

| Metric | Without Cache | With Cache | Savings |
|--------|--------------|------------|---------|
| Monthly Cost | $8,100 | $2,400 | **$5,700/mo** |
| Annual Savings | - | - | **$68,400/yr** |

---

## 🔗 Resources

- [Anthropic Prompt Caching Docs](https://docs.anthropic.com/claude/docs/prompt-caching)
- [MCP SDK Documentation](https://modelcontextprotocol.io)
- [Claude API Pricing](https://www.anthropic.com/pricing)

---

## ✅ Checklist

Use this checklist to ensure prompt caching is properly configured:

- [ ] Using Claude Sonnet 3.5 or newer
- [ ] Using Anthropic API directly (not proxies)
- [ ] Tool definitions marked with `cache_control: { type: "ephemeral" }`
- [ ] System prompts marked with `cache_control: { type: "ephemeral" }`
- [ ] Cacheable content placed at beginning of prompt
- [ ] Cacheable content is stable (not regenerated each request)
- [ ] Monitoring cache hit rate in Anthropic Console
- [ ] Cache hit rate > 70%
- [ ] Seeing 70-90% cost reduction

---

**Status**: Client-side configuration complete ✅

**Next Steps**: Combine with server-side Semantic Caching for maximum savings!
