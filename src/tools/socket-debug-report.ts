import { z } from "zod";
import { execa } from "execa";
import { zodToMcpSchema } from "../utils/schema-converter.js";
import { stringifyGeneric } from "../utils/json-schemas.js";
import { SafeServiceName, SafeTimePeriod } from "../security/input-validators.js";

/**
 * Socket Debug Report (Read-only)
 *
 * Philosophy: produce high-signal reports for humans to decide solutions.
 * - No mutations. No arbitrary shell. Allowlist-only commands.
 * - Optional sudo via `sudo -n` for deeper visibility (still read-only).
 *
 * For remote hosts, prefer existing ssh tools (ssh_execute) and run the same commands remotely.
 */

const socketDebugReportSchema = z.object({
  /** basic = no sudo by default; deep = tries more commands (still read-only) */
  depth: z.enum(["basic", "deep"]).optional().default("basic"),

  /** Use sudo -n (non-interactive). Only increases visibility; still allowlist-only. */
  use_sudo: z.boolean().optional().default(false),

  /** Narrow down results */
  filter: z
    .object({
      port: z.number().int().min(1).max(65535).optional(),
      proto: z.enum(["tcp", "udp", "all"]).optional().default("all"),
      service: SafeServiceName
        .optional()
        .describe("systemd unit name (e.g. sshd.service)"),
      pid: z.number().int().min(1).optional(),
    })
    .optional()
    .default({ proto: "all" }),

  /** Include potentially heavy sections */
  include: z
    .object({
      firewall: z.boolean().optional().default(true),
      dns: z.boolean().optional().default(true),
      routes: z.boolean().optional().default(true),
      systemd: z.boolean().optional().default(true),
      logs: z.boolean().optional().default(true),
    })
    .optional()
    .default({ firewall: true, dns: true, routes: true, systemd: true, logs: true }),

  /** Log window for journalctl */
  logs_since: SafeTimePeriod
    .optional()
    .default("1 hour ago")
    .describe("journalctl --since value (e.g. '30 min ago')"),
});

export const socketDebugReportTool = {
  name: "socket_debug_report",
  description:
    "Read-only socket/network debugging report (ss/ip/nft/systemd/journalctl). Produces structured diagnostics for discussion.",
  defer_loading: true,
  inputSchema: zodToMcpSchema(socketDebugReportSchema),
};

type Args = z.infer<typeof socketDebugReportSchema>;

type Cmd = {
  key: string;
  cmd: string;
  args: string[];
  requireSudo?: boolean;
};

function sudoWrap(useSudo: boolean, requireSudo: boolean | undefined, cmd: string, args: string[]) {
  if (!useSudo || !requireSudo) return { cmd, args };
  // -n: non-interactive (fail fast if not permitted)
  return { cmd: "sudo", args: ["-n", cmd, ...args] };
}

async function runCmd(spec: Cmd, useSudo: boolean) {
  const wrapped = sudoWrap(useSudo, spec.requireSudo, spec.cmd, spec.args);
  try {
    const res = await execa(wrapped.cmd, wrapped.args, {
      timeout: 15_000,
      reject: false,
      env: { ...process.env, LC_ALL: "C" },
    });

    return {
      ok: res.exitCode === 0,
      exitCode: res.exitCode,
      command: `${wrapped.cmd} ${wrapped.args.join(" ")}`.trim(),
      stdout: (res.stdout || "").slice(0, 120_000),
      stderr: (res.stderr || "").slice(0, 80_000),
    };
  } catch (err: any) {
    return {
      ok: false,
      exitCode: null,
      command: `${wrapped.cmd} ${wrapped.args.join(" ")}`.trim(),
      stdout: "",
      stderr: err?.message || String(err),
    };
  }
}

function buildSsFilter(filter: Args["filter"]) {
  const proto = filter?.proto || "all";
  const parts: string[] = [];
  if (proto === "tcp") parts.push("-t");
  if (proto === "udp") parts.push("-u");
  if (proto === "all") parts.push("-t", "-u");
  // -n: no DNS, -p: process (needs privilege), -a: all, -H: no header
  parts.push("-n", "-a", "-H");
  return parts;
}

function redactionHint() {
  return "Note: outputs are not auto-redacted yet; avoid pasting secrets into commands or logs. (We can add redaction rules next.)";
}

export async function handleSocketDebugReport(rawArgs: unknown) {
  const args = socketDebugReportSchema.parse(rawArgs);
  const filter = args.filter || { proto: "all" };
  const include = args.include || { firewall: true, dns: true, routes: true, systemd: true, logs: true };

  const cmds: Cmd[] = [];

  // Identity / platform
  cmds.push({ key: "whoami", cmd: "whoami", args: [] });
  cmds.push({ key: "uname", cmd: "uname", args: ["-a"] });
  cmds.push({ key: "date", cmd: "date", args: ["-Iseconds"] });

  // Sockets
  const ssBase = buildSsFilter(filter);
  if (filter.port) {
    // NOTE: `ss` filter syntax can vary. We'll do best-effort by grepping after.
    cmds.push({ key: "listeners_ss", cmd: "ss", args: ["-l", ...ssBase, "-p"], requireSudo: true });
    cmds.push({ key: "connections_ss", cmd: "ss", args: [...ssBase, "-p"], requireSudo: true });
  } else {
    cmds.push({ key: "listeners_ss", cmd: "ss", args: ["-l", ...ssBase, "-p"], requireSudo: true });
    cmds.push({ key: "connections_ss", cmd: "ss", args: [...ssBase, "-p"], requireSudo: true });
  }

  // Quick addr/link info
  cmds.push({ key: "ip_addr", cmd: "ip", args: ["addr"] });
  cmds.push({ key: "ip_link", cmd: "ip", args: ["link"] });

  if (include.routes) {
    cmds.push({ key: "ip_route", cmd: "ip", args: ["route"] });
    cmds.push({ key: "ip_rule", cmd: "ip", args: ["rule"] });
  }

  if (include.dns) {
    // NixOS often has systemd-resolved, but resolvectl may not exist everywhere.
    cmds.push({ key: "resolvectl_status", cmd: "resolvectl", args: ["status"] });
    cmds.push({ key: "cat_resolv_conf", cmd: "cat", args: ["/etc/resolv.conf"] });
  }

  if (include.firewall) {
    // nft is common on NixOS; iptables may not exist.
    cmds.push({ key: "nft_ruleset", cmd: "nft", args: ["list", "ruleset"], requireSudo: true });
  }

  if (include.systemd) {
    cmds.push({ key: "systemd_failed", cmd: "systemctl", args: ["--no-pager", "--failed"] });
    if (filter.service) {
      cmds.push({ key: "systemd_status", cmd: "systemctl", args: ["--no-pager", "status", filter.service], requireSudo: true });
      cmds.push({ key: "systemd_show", cmd: "systemctl", args: ["show", filter.service, "--no-pager"], requireSudo: true });
    }
  }

  if (include.logs && filter.service) {
    cmds.push({
      key: "journalctl_service",
      cmd: "journalctl",
      args: ["-u", filter.service, "--since", args.logs_since, "--no-pager", "-n", "400"],
      requireSudo: true,
    });
  }

  // Optional deep extras (still read-only)
  if (args.depth === "deep") {
    cmds.push({ key: "sysctl_net", cmd: "sysctl", args: ["-a"] }); // might be large; still bounded by stdout cap
    cmds.push({ key: "nstat", cmd: "nstat", args: ["-az"] });
    // lsof is nice but may not be installed; keep best-effort
    if (filter.port) {
      cmds.push({ key: "lsof_port", cmd: "lsof", args: ["-nP", `-i:${filter.port}`], requireSudo: true });
    } else {
      cmds.push({ key: "lsof_listen", cmd: "lsof", args: ["-nP", "-iTCP", "-sTCP:LISTEN"], requireSudo: true });
    }
  }

  const outputs: Record<string, any> = {};
  for (const c of cmds) {
    outputs[c.key] = await runCmd(c, args.use_sudo);
  }

  // Lightweight post-filtering for port if requested (doesn't mutate raw outputs)
  const notes: string[] = [];
  if (filter.port) {
    notes.push(`Filtered view hint: manually search outputs.listeners_ss/connections_ss for ":${filter.port}"`);
  }
  if (args.use_sudo) {
    notes.push("use_sudo=true: commands that require visibility (ss -p, nft, journalctl, systemctl status) were attempted via sudo -n.");
  } else {
    notes.push("use_sudo=false: process-level socket visibility may be limited (ss -p may omit PIDs).");
  }
  notes.push(redactionHint());

  const report = {
    kind: "socket_debug_report",
    depth: args.depth,
    use_sudo: args.use_sudo,
    filter,
    include,
    notes,
    sections: outputs,
    guidance: {
      triageOrder: [
        "listeners_ss: is the port actually listening? which address (0.0.0.0 vs 127.0.0.1 vs ::)?",
        "connections_ss: are clients reaching it? SYN-SENT / TIME-WAIT patterns?",
        "ip_route/ip_rule: does traffic route where you think?",
        "nft_ruleset: any drop policies / unexpected chains?",
        "systemd_status + journalctl_service: is the service flapping or failing bind()?",
        "dns (resolvectl_status): name resolution issues vs connectivity issues",
      ],
      nextActions: [
        "If a service can't bind: check for existing listener on same port, or permission/capability issues.",
        "If connections hang: check firewall drops, asymmetric routing, or MTU/PMTU issues.",
        "If DNS is wrong: confirm resolved config and /etc/resolv.conf linkage.",
      ],
    },
  };

  return {
    content: [{ type: "text", text: stringifyGeneric(report) }],
  };
}

