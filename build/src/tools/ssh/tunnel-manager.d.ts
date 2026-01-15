/**
 * SSH Tunnel Manager
 * Manages SSH tunnels (Local, Remote, Dynamic)
 */
import { SSHConnectionManager } from './connection-manager.js';
import type { TunnelConfig, LocalTunnelConfig, RemoteTunnelConfig, DynamicTunnelConfig, TunnelResult } from '../../types/ssh-advanced.js';
export declare class SSHTunnelManager {
    private tunnels;
    private connectionManager;
    constructor(connectionManager: SSHConnectionManager);
    createTunnel(config: TunnelConfig): Promise<TunnelResult>;
    createLocalTunnel(config: LocalTunnelConfig): Promise<TunnelResult>;
    createRemoteTunnel(config: RemoteTunnelConfig): Promise<TunnelResult>;
    createDynamicTunnel(config: DynamicTunnelConfig): Promise<TunnelResult>;
    closeTunnel(tunnelId: string): Promise<boolean>;
    private generateTunnelId;
}
//# sourceMappingURL=tunnel-manager.d.ts.map