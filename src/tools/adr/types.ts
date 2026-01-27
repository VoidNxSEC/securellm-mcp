/**
 * ADR (Architecture Decision Records) Module for MCP
 * 
 * Provides tools for creating, managing, and validating ADRs with
 * research-based credibility scoring.
 */

export interface ADRRecord {
    id: string;
    title: string;
    status: "proposed" | "accepted" | "rejected" | "superseded" | "deprecated";
    date: string;
    authors: Array<{
        name: string;
        role: string;
        github?: string;
    }>;
    governance: {
        classification: "critical" | "major" | "minor" | "patch";
        validation?: {
            credibility_score: number;
            validation_date: string;
            method: "research_agent" | "manual";
            sources_count: number;
            confidence: number;
        };
    };
    validation_sources?: Array<{
        type: string;
        title: string;
        url: string;
        credibility: number;
        stars?: number;
        points?: number;
    }>;
    content: string;
}

export interface ResearchData {
    query: string;
    confidence: number;
    sources: Array<{
        source: "github" | "stackoverflow" | "nixos_wiki" | "discourse" | "reddit" | "hackernews" | "official_docs";
        url: string;
        title: string;
        credibility: number;
        content?: string;
        stars?: number;
        points?: number;
    }>;
    consensus: string | null;
    factCheck: {
        verified: boolean;
        officialSource: string | null;
        confidence: number;
        notes: string[];
    };
    conflicts?: Array<{
        topic: string;
        sources: string[];
        positions: string[];
    }>;
    recommendations: string[];
    searchDuration: number;
    sourceCount: number;
}

export interface ADRCreateArgs {
    title: string;
    project?: string;
    classification?: "critical" | "major" | "minor" | "patch";
    research_data?: ResearchData;
}

export interface ADRListArgs {
    status?: "proposed" | "accepted" | "rejected" | "superseded";
    project?: string;
    format?: "table" | "json";
}

export interface ADRShowArgs {
    id: string;
}

export interface ADRAcceptArgs {
    id: string;
}

export interface ADRSearchArgs {
    query: string;
    status_filter?: string;
}
