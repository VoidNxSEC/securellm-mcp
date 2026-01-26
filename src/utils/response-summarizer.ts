/**
 * Response Summarizer for Token Economy
 *
 * Reduces token usage by:
 * - Providing concise summaries instead of full JSON
 * - Smart truncation of large arrays
 * - Removing redundant fields
 * - Formatting for readability
 */

export class ResponseSummarizer {
  /**
   * Summarize model list (most token-heavy response)
   */
  static summarizeModels(models: any[], verbose: boolean = false): string {
    if (models.length === 0) {
      return "No models found.";
    }

    if (verbose) {
      // Full details requested
      return JSON.stringify(models, null, 2);
    }

    // Concise summary
    const lines = [
      `Found ${models.length} models:\n`,
    ];

    // Group by format
    const byFormat = models.reduce((acc, m) => {
      acc[m.format] = (acc[m.format] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    lines.push("By format:");
    for (const [format, count] of Object.entries(byFormat)) {
      lines.push(`  - ${format}: ${count}`);
    }

    // Total size
    const totalSize = models.reduce((sum, m) => sum + m.size_gb, 0);
    const totalVram = models.reduce((sum, m) => sum + m.vram_estimate_gb, 0);
    lines.push(`\nTotal size: ${totalSize.toFixed(1)}GB`);
    lines.push(`Est. VRAM: ${totalVram.toFixed(1)}GB\n`);

    // Show top 10 by size
    const sorted = [...models]
      .sort((a, b) => b.size_gb - a.size_gb)
      .slice(0, 10);

    lines.push("Top models (by size):");
    for (const m of sorted) {
      lines.push(
        `  [${m.id}] ${m.name} - ${m.format} ${m.size_gb.toFixed(1)}GB (VRAM: ${m.vram_estimate_gb.toFixed(1)}GB)`
      );
    }

    if (models.length > 10) {
      lines.push(`\n... and ${models.length - 10} more models`);
    }

    lines.push(
      '\n💡 Tip: Use "get_model_info" with a specific ID for full details'
    );

    return lines.join("\n");
  }

  /**
   * Summarize VRAM status
   */
  static summarizeVram(vram: any, verbose: boolean = false): string {
    if (verbose) {
      return JSON.stringify(vram, null, 2);
    }

    const lines = [
      "🎮 VRAM Status\n",
      `Total: ${vram.total_gb.toFixed(2)}GB`,
      `Used: ${vram.used_gb.toFixed(2)}GB (${vram.utilization_percent.toFixed(1)}%)`,
      `Free: ${vram.free_gb.toFixed(2)}GB`,
    ];

    if (vram.gpus && vram.gpus.length > 0) {
      lines.push(`\nGPUs: ${vram.gpus.length}`);
      for (const gpu of vram.gpus) {
        lines.push(
          `  GPU ${gpu.id}: ${gpu.name} - ${gpu.used_mb}MB/${gpu.total_mb}MB (${gpu.utilization_percent}%, ${gpu.temperature_c}°C)`
        );
      }
    }

    if (vram.processes && vram.processes.length > 0) {
      lines.push(`\nActive processes: ${vram.processes.length}`);
      const topProcs = vram.processes
        .sort((a: any, b: any) => b.memory_mb - a.memory_mb)
        .slice(0, 5);
      for (const proc of topProcs) {
        lines.push(
          `  GPU ${proc.gpu_id}: ${proc.name} (PID ${proc.pid}) - ${proc.memory_mb}MB`
        );
      }
      if (vram.processes.length > 5) {
        lines.push(`  ... and ${vram.processes.length - 5} more`);
      }
    }

    // Alert if high usage
    if (vram.utilization_percent > 85) {
      lines.push("\n⚠️  High VRAM usage! Consider unloading models.");
    }

    return lines.join("\n");
  }

  /**
   * Summarize backends
   */
  static summarizeBackends(backends: any[], verbose: boolean = false): string {
    if (backends.length === 0) {
      return "No backends available.";
    }

    if (verbose) {
      return JSON.stringify(backends, null, 2);
    }

    const lines = [`Found ${backends.length} backends:\n`];

    for (const b of backends) {
      const statusIcon = b.status === "active" ? "✅" : "❌";
      const model = b.loaded_model ? ` - Model: ${b.loaded_model}` : "";
      const vram = b.vram_usage_mb ? ` (${b.vram_usage_mb}MB)` : "";

      lines.push(
        `${statusIcon} ${b.name} (${b.type}) - ${b.status} - ${b.host}:${b.port}${model}${vram}`
      );
    }

    return lines.join("\n");
  }

  /**
   * Summarize system status
   */
  static summarizeStatus(status: any, verbose: boolean = false): string {
    if (verbose) {
      return JSON.stringify(status, null, 2);
    }

    const lines = [
      "📊 System Status\n",
      `Timestamp: ${status.timestamp}`,
      "",
      "VRAM:",
      `  Total: ${status.vram.total_gb.toFixed(2)}GB`,
      `  Used: ${status.vram.used_gb.toFixed(2)}GB (${status.vram.utilization_percent.toFixed(1)}%)`,
      `  Free: ${status.vram.free_gb.toFixed(2)}GB`,
    ];

    if (status.backends && status.backends.length > 0) {
      lines.push("");
      lines.push("Backends:");
      for (const b of status.backends) {
        const statusIcon = b.status === "active" ? "✅" : "❌";
        lines.push(`  ${statusIcon} ${b.name}: ${b.status}`);
      }
    }

    if (status.loaded_models && status.loaded_models.length > 0) {
      lines.push("");
      lines.push(`Loaded models: ${status.loaded_models.length}`);
      for (const m of status.loaded_models) {
        lines.push(`  - ${m}`);
      }
    }

    if (status.pending_queue && status.pending_queue.length > 0) {
      lines.push("");
      lines.push(`Pending queue: ${status.pending_queue.length}`);
    }

    return lines.join("\n");
  }

  /**
   * Summarize model info (single model)
   */
  static summarizeModelInfo(model: any, verbose: boolean = false): string {
    if (verbose) {
      return JSON.stringify(model, null, 2);
    }

    const backends = JSON.parse(model.compatible_backends || "[]").join(", ");
    const tags = model.tags ? JSON.parse(model.tags).join(", ") : "none";

    const lines = [
      `📦 Model: ${model.name}\n`,
      `ID: ${model.id}`,
      `Format: ${model.format}`,
      `Size: ${model.size_gb.toFixed(2)}GB`,
      `Est. VRAM: ${model.vram_estimate_gb.toFixed(2)}GB`,
      "",
      `Architecture: ${model.architecture || "unknown"}`,
      `Quantization: ${model.quantization || "N/A"}`,
      `Parameters: ${model.parameter_count || "unknown"}`,
      `Context: ${model.context_length || "unknown"}`,
      "",
      `Compatible backends: ${backends || "none"}`,
      `Priority: ${model.priority}`,
      `Usage count: ${model.usage_count}`,
      `Last used: ${model.last_used || "never"}`,
      `Last scanned: ${model.last_scanned}`,
      "",
      `Path: ${model.path}`,
    ];

    if (tags && tags !== "none") {
      lines.push(`Tags: ${tags}`);
    }

    if (model.notes) {
      lines.push(`Notes: ${model.notes}`);
    }

    return lines.join("\n");
  }

  /**
   * Summarize health check
   */
  static summarizeHealth(health: any, verbose: boolean = false): string {
    if (verbose) {
      return JSON.stringify(health, null, 2);
    }

    const statusIcon = health.status === "healthy" ? "✅" : "⚠️";

    const lines = [
      `${statusIcon} ML Offload API: ${health.status}`,
      `Version: ${health.version}`,
      `Timestamp: ${health.timestamp}`,
      "",
      "Services:",
    ];

    for (const [service, status] of Object.entries(health.services)) {
      const icon = status ? "✅" : "❌";
      lines.push(`  ${icon} ${service}: ${status ? "OK" : "FAIL"}`);
    }

    return lines.join("\n");
  }

  /**
   * Generic operation result
   */
  static summarizeOperation(result: any, operation: string): string {
    const lines = [
      `✅ ${operation} successful`,
      "",
      JSON.stringify(result, null, 2),
    ];
    return lines.join("\n");
  }

  /**
   * Token usage estimate (rough)
   */
  static estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Log token savings
   */
  static logSavings(original: string, summarized: string): void {
    const originalTokens = this.estimateTokens(original);
    const summarizedTokens = this.estimateTokens(summarized);
    const savings = originalTokens - summarizedTokens;
    const savingsPercent = ((savings / originalTokens) * 100).toFixed(1);

    console.error(
      `[Summarizer] Tokens: ${originalTokens} → ${summarizedTokens} (saved ${savings} tokens, ${savingsPercent}%)`
    );
  }
}
