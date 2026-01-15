/**
 * SSH Session Manager
 * Manages persistent SSH sessions
 */
import Database from 'better-sqlite3';
export class SSHSessionManager {
    db;
    sessions = new Map();
    recoveryTimers = new Map();
    connectionManager;
    tunnelManager;
    jumpHostManager;
    constructor(dbPath, connectionManager, tunnelManager, jumpHostManager) {
        this.db = new Database(dbPath);
        this.connectionManager = connectionManager;
        this.tunnelManager = tunnelManager;
        this.jumpHostManager = jumpHostManager;
        this.initDatabase();
        this.loadSessions();
    }
    initDatabase() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        connection_config TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_active TEXT NOT NULL,
        persist INTEGER DEFAULT 0,
        auto_recover INTEGER DEFAULT 0,
        recovery_count INTEGER DEFAULT 0,
        state_data TEXT
      );
      
      CREATE TABLE IF NOT EXISTS session_resources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_config TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
      );
    `);
    }
    loadSessions() {
        const rows = this.db.prepare('SELECT * FROM sessions WHERE auto_recover = 1').all();
        for (const row of rows) {
            // In a real app, we might try to restore these on startup
            // For now, just register them
            const sessionData = JSON.parse(row.state_data);
            this.sessions.set(row.session_id, {
                session_id: row.session_id,
                status: 'closed', // Needs restoration
                created_at: new Date(row.created_at),
                last_active: new Date(row.last_active),
                persisted: !!row.persist,
                auto_recover: !!row.auto_recover,
                recovery_count: row.recovery_count,
                has_tunnels: !!sessionData.tunnels,
                has_port_forwards: !!sessionData.port_forwards,
                has_jump_chain: !!sessionData.jump_chain
            });
        }
    }
    async persistSession(config) {
        const sessionId = this.generateSessionId();
        const conn = this.connectionManager.getConnection(config.connection_id);
        if (!conn) {
            throw new Error('Connection not found');
        }
        const sessionData = {
            session_id: sessionId,
            connection_config: conn.config,
            created_at: new Date().toISOString(),
            last_active: new Date().toISOString(),
            connection_metadata: {
                bytes_sent: conn.bytes_sent,
                bytes_received: conn.bytes_received,
                commands_executed: conn.commands_executed
            },
            // In a real impl, we'd query tunnelManager for active tunnels for this connection
            tunnels: [],
            port_forwards: [],
            jump_chain: undefined,
            recovery_count: 0,
            recovery_state: 'stable'
        };
        if (config.persist) {
            this.db.prepare(`
        INSERT INTO sessions (session_id, connection_config, created_at, last_active, persist, auto_recover, state_data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(sessionId, JSON.stringify(sessionData.connection_config), sessionData.created_at, sessionData.last_active, 1, config.auto_recover ? 1 : 0, JSON.stringify(sessionData));
        }
        const sessionInfo = {
            session_id: sessionId,
            connection_id: config.connection_id,
            status: 'active',
            created_at: new Date(),
            last_active: new Date(),
            persisted: !!config.persist,
            auto_recover: !!config.auto_recover,
            recovery_count: 0,
            has_tunnels: false,
            has_port_forwards: false,
            has_jump_chain: false
        };
        this.sessions.set(sessionId, sessionInfo);
        if (config.auto_recover) {
            this.setupAutoRecovery(sessionId, config);
        }
        return sessionData;
    }
    async restoreSession(sessionId) {
        const row = this.db.prepare(`
      SELECT * FROM sessions WHERE session_id = ?
    `).get(sessionId);
        if (!row) {
            return {
                success: false,
                error: 'Session not found',
                timestamp: new Date().toISOString()
            };
        }
        const sessionData = JSON.parse(row.state_data);
        const start = Date.now();
        try {
            const conn = await this.connectionManager.connect(sessionData.connection_config);
            this.db.prepare(`
        UPDATE sessions 
        SET last_active = ?, recovery_count = recovery_count + 1
        WHERE session_id = ?
      `).run(new Date().toISOString(), sessionId);
            // Update in-memory state
            const sessionInfo = this.sessions.get(sessionId);
            if (sessionInfo) {
                sessionInfo.status = 'active';
                sessionInfo.connection_id = conn.data?.connection_id;
                sessionInfo.last_active = new Date();
                sessionInfo.recovery_count++;
            }
            return {
                success: true,
                data: {
                    session_id: sessionId,
                    connection_id: conn.data?.connection_id,
                    recovery_time_ms: Date.now() - start,
                    recovered_resources: { tunnels: 0, port_forwards: 0, jump_chain: false },
                    warnings: []
                },
                timestamp: new Date().toISOString()
            };
        }
        catch (error) {
            return {
                success: false,
                error: `Session recovery failed: ${error.message}`,
                timestamp: new Date().toISOString()
            };
        }
    }
    setupAutoRecovery(sessionId, config) {
        const maxAttempts = config.max_recovery_attempts || 3;
        const backoffMs = config.recovery_backoff_ms || 5000;
        const attemptRecovery = async (attempt = 1) => {
            if (attempt > maxAttempts) {
                return;
            }
            const sessionInfo = this.sessions.get(sessionId);
            if (!sessionInfo || !sessionInfo.connection_id)
                return;
            const conn = this.connectionManager.getConnection(sessionInfo.connection_id);
            if (conn && conn.connected) {
                this.scheduleNextCheck(sessionId, config);
                return;
            }
            try {
                const result = await this.restoreSession(sessionId);
                if (result.success) {
                    this.scheduleNextCheck(sessionId, config);
                }
                else {
                    const delay = this.calculateBackoff(attempt, backoffMs);
                    setTimeout(() => attemptRecovery(attempt + 1), delay);
                }
            }
            catch {
                const delay = this.calculateBackoff(attempt, backoffMs);
                setTimeout(() => attemptRecovery(attempt + 1), delay);
            }
        };
        this.scheduleNextCheck(sessionId, config, attemptRecovery);
    }
    scheduleNextCheck(sessionId, config, callback) {
        const existing = this.recoveryTimers.get(sessionId);
        if (existing)
            clearTimeout(existing);
        const timer = setTimeout(callback || (() => this.setupAutoRecovery(sessionId, config)), 30000);
        this.recoveryTimers.set(sessionId, timer);
    }
    calculateBackoff(attempt, baseMs) {
        return Math.min(baseMs * Math.pow(2, attempt - 1), 60000);
    }
    generateSessionId() {
        return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    close() {
        this.db.close();
        for (const timer of this.recoveryTimers.values()) {
            clearTimeout(timer);
        }
        this.recoveryTimers.clear();
    }
}
//# sourceMappingURL=session-manager.js.map