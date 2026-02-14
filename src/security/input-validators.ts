/**
 * Centralized Input Validators
 *
 * Reusable validators for security-sensitive inputs across all tools.
 * Uses Zod for schema validation with branded types for type safety.
 */

import { z } from 'zod';
import { validatePath as _validatePath } from './path-validator.js';

// ─── Path Validators ───────────────────────────────────────────────

/**
 * Safe filesystem path - validated against a root boundary.
 * Usage: SafePath(allowedRoot).parse(userInput)
 */
export const SafePath = (allowedRoot: string) =>
  z.string().transform((s) => _validatePath(s, allowedRoot));

// ─── Service / Process Names ───────────────────────────────────────

/** systemd service name: starts with letter, max 64 chars, safe chars only */
export const SafeServiceName = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_.@-]{0,63}$/,
    'Service name must start with a letter and contain only alphanumeric, dots, underscores, @ or hyphens'
  );

// ─── Network Validators ───────────────────────────────────────────

/** Hostname or IPv4/IPv6 address - no shell metacharacters */
export const SafeHostname = z
  .string()
  .min(1)
  .max(253)
  .regex(
    /^[a-zA-Z0-9._:-]+$/,
    'Hostname must contain only alphanumeric, dots, colons, hyphens or underscores'
  );

/** Port number: 1-65535 */
export const SafePort = z.number().int().min(1).max(65535);

/** MFA / OTP code: exactly 6 digits */
export const SafeMfaCode = z
  .string()
  .regex(/^\d{6}$/, 'MFA code must be exactly 6 digits');

// ─── Time / Duration Validators ───────────────────────────────────

/** journalctl --since format: "<number> <unit> ago" */
export const SafeTimePeriod = z
  .string()
  .regex(
    /^\d+\s+(second|minute|hour|day|week|month)s?\s+ago$/,
    'Time period must match format: "<number> <unit> ago" (e.g. "30 minute ago")'
  );

// ─── Shell Safety ─────────────────────────────────────────────────

/** Characters that can break shell command boundaries */
const SHELL_META_PATTERN = /[;&|`$<>\n\r\\!#~{}()\[\]]/;

/** Test whether a string contains shell metacharacters */
export function hasShellMeta(value: string): boolean {
  return (
    SHELL_META_PATTERN.test(value) ||
    value.includes('"') ||
    value.includes("'")
  );
}

/** A string free of shell metacharacters */
export const ShellSafeString = z
  .string()
  .refine((v) => !hasShellMeta(v), {
    message: 'Value contains unsafe shell metacharacters',
  });

// ─── Kubernetes / Infrastructure ──────────────────────────────────

/** K8s resource name: lowercase alphanumeric + hyphens, 63 chars max */
export const SafeK8sName = z
  .string()
  .min(1)
  .max(63)
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
    'Must be lowercase alphanumeric with optional hyphens, not starting/ending with hyphen'
  );

/** Volume / resource name: alphanumeric + hyphens + underscores */
export const SafeResourceName = z
  .string()
  .min(1)
  .max(253)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/,
    'Resource name must start with alphanumeric and contain only alphanumeric, hyphens or underscores'
  );

/** CIDR notation: 0-32 for IPv4 */
export const SafeCidrMask = z.number().int().min(0).max(32);

// ─── Generic Validators ───────────────────────────────────────────

/** Non-empty trimmed string */
export const NonEmptyString = z.string().min(1).trim();

/** Positive integer */
export const PositiveInt = z.number().int().positive();
