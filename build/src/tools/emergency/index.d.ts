/**
 * Emergency Framework Tools
 *
 * MCP tools for emergency response and system recovery
 */
import type { ExtendedTool } from '../../types/mcp-tool-extensions.js';
export declare const emergencyTools: ExtendedTool[];
interface EmergencyStatusResult {
    status: 'ok' | 'warning' | 'critical' | 'emergency';
    timestamp: string;
    metrics: {
        cpu: {
            load: number;
            cores: number;
            thermal: number;
            governor: string;
        };
        memory: {
            used_gb: number;
            available_gb: number;
            percentage: number;
        };
        swap: {
            used_gb: number;
            total_gb: number;
            percentage: number;
        };
        disk: {
            used_percentage: number;
            available_gb: number;
        };
    };
    alerts: string[];
    recommendations: string[];
}
interface EmergencyAbortResult {
    success: boolean;
    processes_killed: number;
    message: string;
}
interface SystemHealthResult {
    verdict: 'HEALTHY' | 'WARNING' | 'CRITICAL';
    score: number;
    checks: Array<{
        category: string;
        status: 'pass' | 'warning' | 'fail';
        message: string;
    }>;
    timestamp: string;
}
export declare function handleEmergencyStatus(): Promise<EmergencyStatusResult>;
export declare function handleEmergencyAbort(force?: boolean): Promise<EmergencyAbortResult>;
export declare function handleEmergencyCooldown(): Promise<{
    success: boolean;
    message: string;
}>;
export declare function handleEmergencyNuke(confirm: boolean): Promise<EmergencyAbortResult>;
export declare function handleEmergencySwap(): Promise<{
    success: boolean;
    freed_mb: number;
    message: string;
}>;
export declare function handleSystemHealthCheck(detailed?: boolean): Promise<SystemHealthResult>;
export declare function handleSafeRebuildCheck(): Promise<{
    safe: boolean;
    reason: string;
    metrics: any;
}>;
export {};
//# sourceMappingURL=index.d.ts.map