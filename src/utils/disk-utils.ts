// Disk Utilities

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Get available disk space in bytes for a given path
 */
export async function diskUsage(path: string = '/'): Promise<number> {
  try {
    const { stdout } = await execAsync(`df -k "${path}" | tail -1 | awk '{print $4}'`);
    const availableKB = parseInt(stdout.trim(), 10);
    return availableKB * 1024; // Convert KB to bytes
  } catch (err) {
    // Fallback: assume 10GB available
    return 10 * 1024 * 1024 * 1024;
  }
}

/**
 * Get total disk space in bytes for a given path
 */
export async function totalDiskSpace(path: string = '/'): Promise<number> {
  try {
    const { stdout } = await execAsync(`df -k "${path}" | tail -1 | awk '{print $2}'`);
    const totalKB = parseInt(stdout.trim(), 10);
    return totalKB * 1024;
  } catch (err) {
    // Fallback
    return 100 * 1024 * 1024 * 1024;
  }
}

/**
 * Get used disk space in bytes for a given path
 */
export async function usedDiskSpace(path: string = '/'): Promise<number> {
  try {
    const { stdout } = await execAsync(`df -k "${path}" | tail -1 | awk '{print $3}'`);
    const usedKB = parseInt(stdout.trim(), 10);
    return usedKB * 1024;
  } catch (err) {
    // Fallback
    return 50 * 1024 * 1024 * 1024;
  }
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
