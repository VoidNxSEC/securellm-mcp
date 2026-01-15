/**
 * SSH Tools - Remote Access and Maintenance
 * All SSH-related tools for secure remote operations
 */
import type { SSHExecuteArgs, SSHFileTransferArgs, SSHMaintenanceCheckArgs, ToolResult } from '../../types/extended-tools.js';
export { SSHConnectionManager, sshConnectSchema } from './connection-manager.js';
/**
 * SSH Execute Tool
 */
export declare class SSHExecuteTool {
    private allowedCommands;
    execute(args: SSHExecuteArgs): Promise<ToolResult>;
}
/**
 * SSH File Transfer Tool (SFTP)
 */
export declare class SSHFileTransferTool {
    execute(args: SSHFileTransferArgs): Promise<ToolResult>;
}
/**
 * SSH Maintenance Check Tool
 */
export declare class SSHMaintenanceCheckTool {
    execute(args: SSHMaintenanceCheckArgs): Promise<ToolResult>;
    private runCheck;
}
/**
 * SSH Tunnel Tool
 */
export declare class SSHTunnelTool {
    execute(args: any): Promise<ToolResult>;
}
/**
 * SSH Jump Host Tool
 */
export declare class SSHJumpHostTool {
    execute(args: any): Promise<ToolResult>;
}
/**
 * SSH Session Tool
 */
export declare class SSHSessionTool {
    execute(args: any): Promise<ToolResult>;
}
export declare const sshExecuteSchema: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            connection_id: {
                type: string;
                description: string;
            };
            command: {
                type: string;
                description: string;
            };
            timeout_seconds: {
                type: string;
                description: string;
            };
            sudo: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
export declare const sshFileTransferSchema: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            connection_id: {
                type: string;
                description: string;
            };
            action: {
                type: string;
                enum: string[];
            };
            local_path: {
                type: string;
                description: string;
            };
            remote_path: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
export declare const sshMaintenanceCheckSchema: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            connection_id: {
                type: string;
                description: string;
            };
            checks: {
                type: string;
                items: {
                    type: string;
                    enum: string[];
                };
                description: string;
            };
        };
        required: string[];
    };
};
export declare const sshTunnelSchema: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            type: {
                type: string;
                enum: string[];
            };
            connection_id: {
                type: string;
            };
            local_port: {
                type: string;
            };
            remote_host: {
                type: string;
            };
            remote_port: {
                type: string;
            };
            socks_port: {
                type: string;
            };
            bind_address: {
                type: string;
            };
            keep_alive: {
                type: string;
            };
            auto_restart: {
                type: string;
            };
        };
        required: string[];
    };
};
export declare const sshJumpHostSchema: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            target: {
                type: string;
            };
            jumps: {
                type: string;
                items: {
                    type: string;
                };
            };
            strategy: {
                type: string;
                enum: string[];
            };
            cache_successful_path: {
                type: string;
            };
        };
        required: string[];
    };
};
export declare const sshSessionSchema: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            action: {
                type: string;
                enum: string[];
            };
            connection_id: {
                type: string;
            };
            session_id: {
                type: string;
            };
            persist: {
                type: string;
            };
            auto_recover: {
                type: string;
            };
        };
        required: string[];
    };
};
export declare const sshTools: (SSHExecuteTool | SSHFileTransferTool | SSHMaintenanceCheckTool | SSHTunnelTool | SSHJumpHostTool | SSHSessionTool)[];
//# sourceMappingURL=index.d.ts.map