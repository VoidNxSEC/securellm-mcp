/**
 * SSH Session Manager
 * Manages persistent SSH sessions
 */
import { SSHConnectionManager } from './connection-manager.js';
import { SSHTunnelManager } from './tunnel-manager.js';
import { SSHJumpHostManager } from './jump-host-manager.js';
import type { SessionConfig, SessionData, SessionRecoveryResult } from '../../types/ssh-advanced.js';
export declare class SSHSessionManager {
    private db;
    private sessions;
    private recoveryTimers;
    private connectionManager;
    private tunnelManager;
    private jumpHostManager;
    constructor(dbPath: string, connectionManager: SSHConnectionManager, tunnelManager: SSHTunnelManager, jumpHostManager: SSHJumpHostManager);
    private initDatabase;
    private loadSessions;
    persistSession(config: SessionConfig): Promise<SessionData>;
    restoreSession(sessionId: string): Promise<SessionRecoveryResult>;
    private setupAutoRecovery;
    private scheduleNextCheck;
    private calculateBackoff;
    private generateSessionId;
    close(): void;
}
//# sourceMappingURL=session-manager.d.ts.map