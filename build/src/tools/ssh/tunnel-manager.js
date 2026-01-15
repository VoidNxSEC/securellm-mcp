/**
 * SSH Tunnel Manager
 * Manages SSH tunnels (Local, Remote, Dynamic)
 */
import * as net from 'net';
export class SSHTunnelManager {
    tunnels = new Map();
    connectionManager;
    constructor(connectionManager) {
        this.connectionManager = connectionManager;
    }
    async createTunnel(config) {
        switch (config.type) {
            case 'local':
                return this.createLocalTunnel(config);
            case 'remote':
                return this.createRemoteTunnel(config);
            case 'dynamic':
                return this.createDynamicTunnel(config);
            default:
                throw new Error(`Unknown tunnel type: ${config.type}`);
        }
    }
    async createLocalTunnel(config) {
        const conn = this.connectionManager.getConnection(config.connection_id);
        if (!conn) {
            throw new Error('Connection not found');
        }
        const tunnelId = this.generateTunnelId();
        const server = net.createServer(async (socket) => {
            try {
                conn.client.forwardOut(socket.remoteAddress || '127.0.0.1', socket.remotePort || 0, config.remote_host, config.remote_port, (err, stream) => {
                    if (err) {
                        socket.end();
                        return;
                    }
                    const tunnel = this.tunnels.get(tunnelId);
                    if (tunnel)
                        tunnel.connections_count++;
                    socket.pipe(stream).pipe(socket);
                    stream.on('data', (data) => {
                        const tunnel = this.tunnels.get(tunnelId);
                        if (tunnel)
                            tunnel.bytes_transferred += data.length;
                    });
                });
            }
            catch (err) {
                socket.end();
            }
        });
        return new Promise((resolve, reject) => {
            server.listen(config.local_port, config.bind_address || 'localhost', () => {
                const tunnel = {
                    id: tunnelId,
                    config,
                    connection_id: config.connection_id,
                    status: 'active',
                    created_at: new Date(),
                    local_endpoint: `${config.bind_address || 'localhost'}:${config.local_port}`,
                    remote_endpoint: `${config.remote_host}:${config.remote_port}`,
                    bytes_transferred: 0,
                    connections_count: 0,
                    errors_count: 0,
                    reconnect_attempts: 0,
                    server
                };
                this.tunnels.set(tunnelId, tunnel);
                resolve({
                    success: true,
                    data: {
                        tunnel_id: tunnelId,
                        type: 'local',
                        local_endpoint: tunnel.local_endpoint,
                        remote_endpoint: tunnel.remote_endpoint,
                        status: 'active'
                    },
                    timestamp: new Date().toISOString()
                });
            });
            server.on('error', (err) => {
                reject(err);
            });
        });
    }
    async createRemoteTunnel(config) {
        const conn = this.connectionManager.getConnection(config.connection_id);
        if (!conn) {
            throw new Error('Connection not found');
        }
        const tunnelId = this.generateTunnelId();
        return new Promise((resolve, reject) => {
            conn.client.forwardIn(config.bind_address || 'localhost', config.remote_port, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                conn.client.on('tcp connection', (info, accept, reject) => {
                    const stream = accept();
                    // Forward to local destination
                    const localSocket = net.connect(config.local_port, config.local_host);
                    stream.pipe(localSocket).pipe(stream);
                    const tunnel = this.tunnels.get(tunnelId);
                    if (tunnel) {
                        tunnel.connections_count++;
                        stream.on('data', (data) => {
                            tunnel.bytes_transferred += data.length;
                        });
                    }
                });
                const tunnel = {
                    id: tunnelId,
                    config,
                    connection_id: config.connection_id,
                    status: 'active',
                    created_at: new Date(),
                    local_endpoint: `${config.local_host}:${config.local_port}`,
                    remote_endpoint: `${config.bind_address || 'localhost'}:${config.remote_port}`,
                    bytes_transferred: 0,
                    connections_count: 0,
                    errors_count: 0,
                    reconnect_attempts: 0
                };
                this.tunnels.set(tunnelId, tunnel);
                resolve({
                    success: true,
                    data: {
                        tunnel_id: tunnelId,
                        type: 'remote',
                        local_endpoint: tunnel.local_endpoint,
                        remote_endpoint: tunnel.remote_endpoint,
                        status: 'active'
                    },
                    timestamp: new Date().toISOString()
                });
            });
        });
    }
    async createDynamicTunnel(config) {
        const conn = this.connectionManager.getConnection(config.connection_id);
        if (!conn) {
            throw new Error('Connection not found');
        }
        const tunnelId = this.generateTunnelId();
        // Basic SOCKS5 server implementation
        const server = net.createServer((socket) => {
            socket.once('data', (data) => {
                // SOCKS handshake
                if (data[0] !== 0x05) {
                    socket.end();
                    return;
                }
                // No auth required
                socket.write(Buffer.from([0x05, 0x00]));
                socket.once('data', (data) => {
                    // Request details
                    if (data[0] !== 0x05 || data[1] !== 0x01) { // 0x01 = CONNECT
                        socket.end();
                        return;
                    }
                    let addr;
                    let port;
                    let offset = 3; // VER, CMD, RSV
                    const addrType = data[3];
                    if (addrType === 0x01) { // IPv4
                        addr = data.subarray(4, 8).join('.');
                        offset = 8;
                    }
                    else if (addrType === 0x03) { // Domain
                        const len = data[4];
                        addr = data.subarray(5, 5 + len).toString();
                        offset = 5 + len;
                    }
                    else if (addrType === 0x04) { // IPv6
                        // IPv6 support omitted for brevity/complexity in raw parsing
                        socket.end();
                        return;
                    }
                    else {
                        socket.end();
                        return;
                    }
                    port = data.readUInt16BE(offset);
                    // Forward through SSH
                    conn.client.forwardOut(socket.remoteAddress || '127.0.0.1', socket.remotePort || 0, addr, port, (err, stream) => {
                        if (err) {
                            // Reply connection failed
                            socket.write(Buffer.from([0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                            socket.end();
                            return;
                        }
                        // Reply success
                        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                        socket.pipe(stream).pipe(socket);
                        const tunnel = this.tunnels.get(tunnelId);
                        if (tunnel) {
                            tunnel.connections_count++;
                            stream.on('data', (d) => {
                                tunnel.bytes_transferred += d.length;
                            });
                        }
                    });
                });
            });
        });
        return new Promise((resolve, reject) => {
            server.listen(config.socks_port, config.bind_address || 'localhost', () => {
                const tunnel = {
                    id: tunnelId,
                    config,
                    connection_id: config.connection_id,
                    status: 'active',
                    created_at: new Date(),
                    local_endpoint: `socks5://${config.bind_address || 'localhost'}:${config.socks_port}`,
                    remote_endpoint: 'dynamic',
                    bytes_transferred: 0,
                    connections_count: 0,
                    errors_count: 0,
                    reconnect_attempts: 0,
                    server
                };
                this.tunnels.set(tunnelId, tunnel);
                resolve({
                    success: true,
                    data: {
                        tunnel_id: tunnelId,
                        type: 'dynamic',
                        local_endpoint: tunnel.local_endpoint,
                        remote_endpoint: 'dynamic',
                        status: 'active'
                    },
                    timestamp: new Date().toISOString()
                });
            });
            server.on('error', reject);
        });
    }
    async closeTunnel(tunnelId) {
        const tunnel = this.tunnels.get(tunnelId);
        if (!tunnel)
            return false;
        if (tunnel.server) {
            tunnel.server.close();
        }
        // If remote, we should ideally unforward, but ssh2 client logic for unforwarding
        // depends on keeping track of the listener. For now, we assume connection close handles it
        // or we'll need to expand Connection interface to track forwards.
        tunnel.status = 'closed';
        this.tunnels.delete(tunnelId);
        return true;
    }
    generateTunnelId() {
        return `tunnel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
}
//# sourceMappingURL=tunnel-manager.js.map