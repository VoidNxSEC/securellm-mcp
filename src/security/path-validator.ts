/**
 * Path Traversal Protection
 *
 * Validates that user-provided paths resolve within allowed boundaries,
 * preventing directory traversal attacks (e.g., ../../etc/passwd).
 */

import * as path from 'path';

/**
 * Validates that a user-provided path resolves within the allowed root directory.
 * Throws if the path would escape the boundary.
 *
 * @param userPath - The user-supplied path to validate
 * @param allowedRoot - The root directory that userPath must stay within
 * @returns The resolved absolute path (safe to use)
 */
export function validatePath(userPath: string, allowedRoot: string): string {
  const resolved = path.resolve(userPath);
  const normalizedRoot = path.resolve(allowedRoot);

  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    throw new Error(`Path "${userPath}" escapes allowed boundary "${allowedRoot}"`);
  }

  return resolved;
}

/**
 * Validates multiple paths against an allowed root.
 *
 * @param paths - Array of user-supplied paths
 * @param allowedRoot - The root directory that all paths must stay within
 * @returns Array of resolved absolute paths
 */
export function validatePaths(paths: string[], allowedRoot: string): string[] {
  return paths.map(p => validatePath(p, allowedRoot));
}

/**
 * Checks if a path is within a boundary without throwing.
 * Useful for filtering rather than rejecting.
 */
export function isPathWithinBoundary(userPath: string, allowedRoot: string): boolean {
  try {
    validatePath(userPath, allowedRoot);
    return true;
  } catch {
    return false;
  }
}
