/**
 * SSH Jump Host Manager
 * Manages multi-hop SSH connections
 */
import { SSHConnectionManager } from './connection-manager.js';
import type { JumpChainConfig, JumpChainResult } from '../../types/ssh-advanced.js';
export declare class SSHJumpHostManager {
    private chains;
    private connectionManager;
    private pathCache;
    constructor(connectionManager: SSHConnectionManager);
    connectThroughJumps(config: JumpChainConfig): Promise<JumpChainResult>;
    private chainConnections;
    private forwardConnection;
    private connectSequential;
    private connectOptimal;
    private cachePath;
    private getCachedPath;
    private generateChainId;
}
//# sourceMappingURL=jump-host-manager.d.ts.map