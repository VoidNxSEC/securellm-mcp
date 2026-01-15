/**
 * SSH Connection Manager
 * Manages SSH connections with security controls, pooling, and health monitoring
 */
import { Client } from 'ssh2';
import type { SSHConnectArgs, SSHConnectionResult } from '../../types/extended-tools.js';
export interface Connection {
    id: string;
    client: Client;
    host: string;
    username: string;
    connected: boolean;
    created: Date;
    config: any;
    created_at: Date;
    last_used: Date;
    error_count: number;
    health_status: 'healthy' | 'degraded' | 'failed';
    bytes_sent: number;
    bytes_received: number;
    commands_executed: number;
}
export interface ConnectionPoolConfig {
    max_connections: number;
    max_idle_time_ms: number;
    health_check_interval_ms: number;
}
export interface HealthStatus {
    connection_id: string;
    status: 'healthy' | 'degraded' | 'failed';
    latency_ms: number;
    uptime_seconds: number;
    last_check: Date;
    issues: string[];
    metrics: {
        success_rate: number;
        avg_latency_ms: number;
        error_count: number;
    };
}
export declare class SSHConnectionManager {
    private connections;
    private pool;
    private allowedHosts;
    private config;
    private healthCheckInterval?;
    constructor(allowedHosts?: string[], config?: Partial<ConnectionPoolConfig>);
    private startHealthMonitoring;
    private checkAllConnections;
    connect(args: SSHConnectArgs): Promise<SSHConnectionResult>;
    connectWithMFA(config: SSHConnectArgs, mfaCode: string): Promise<SSHConnectionResult>;
    getConnection(connectionId: string): Connection | undefined;
    private generateConnectionKey;
    getOrCreateConnection(args: SSHConnectArgs): Promise<Connection>;
    pruneIdleConnections(maxIdleTime?: number): Promise<number>;
    private healthCheck;
    disconnect(connectionId: string): boolean;
    disconnectAll(): void;
    listConnections(): Array<{
        id: string;
        host: string;
        username: string;
        uptime: number;
        health: string;
    }>;
}
export declare const sshConnectSchema: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            host: {
                type: string;
                description: string;
            };
            port: {
                type: string;
                description: string;
            };
            username: {
                type: string;
                description: string;
            };
            auth_method: {
                type: string;
                enum: string[];
            };
            key_path: {
                type: string;
                description: string;
            };
            password: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
//# sourceMappingURL=connection-manager.d.ts.map