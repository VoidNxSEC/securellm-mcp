/**
 * Research Data Parser for ADR Generation
 * 
 * Transforms research_agent output into ADR-compatible formats
 */

import type { ResearchData, ADRRecord } from "../types.js";

export class ResearchParser {
    /**
     * Calculate credibility score from research data (0-10 scale)
     */
    static calculateCredibilityScore(research: ResearchData): number {
        if (research.sources.length === 0) return 0;

        // Weighted average of source credibilities (70% weight)
        const avgCredibility =
            research.sources.reduce((sum, s) => sum + s.credibility, 0) / research.sources.length;
        const credibilityScore = avgCredibility * 7;

        // Source diversity bonus (20% weight)
        const uniqueSources = new Set(research.sources.map(s => s.source)).size;
        const diversityBonus = Math.min(uniqueSources * 0.5, 2);

        // Fact-check bonus (10% weight)
        const factCheckBonus = research.factCheck.verified ? 1 : 0;

        const totalScore = credibilityScore + diversityBonus + factCheckBonus;
        return Math.min(Math.round(totalScore * 10) / 10, 10);
    }

    /**
     * Generate ADR YAML frontmatter from research data
     */
    static toADRFrontmatter(research: ResearchData, title: string, project: string = "GLOBAL"): string {
        const credibilityScore = this.calculateCredibilityScore(research);
        const date = new Date().toISOString().split('T')[0];
        const timestamp = new Date().toISOString();

        const validationSources = research.sources.map(s => {
            const source: any = {
                type: s.source,
                title: s.title,
                url: s.url,
                credibility: s.credibility
            };

            if (s.stars !== undefined) source.stars = s.stars;
            if (s.points !== undefined) source.points = s.points;

            return source;
        });

        return `---
id: "ADR-${String(Date.now()).slice(-4)}"
title: "${title}"
status: proposed
date: "${date}"

authors:
  - name: "AI Agent"
    role: "Research Assistant"
    github: "securellm-mcp"

reviewers: []

governance:
  classification: "major"
  requires_approval_from:
    - architect
  compliance_tags: []
  review_deadline: "${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}"
  auto_supersede_after: "1y"
  validation:
    credibility_score: ${credibilityScore}
    validation_date: "${date}"
    method: "research_agent"
    sources_count: ${research.sources.length}
    confidence: ${research.confidence.toFixed(2)}

scope:
  projects:
    - ${project}
  layers:
    - infrastructure
  environments:
    - all

validation_sources:
${validationSources.map(s => `  - type: "${s.type}"
    title: "${s.title}"
    url: "${s.url}"
    credibility: ${s.credibility}${s.stars !== undefined ? `\n    stars: ${s.stars}` : ''}${s.points !== undefined ? `\n    points: ${s.points}` : ''}`).join('\n')}

rationale:
  drivers: []
  alternatives_considered: []
  trade_offs: []

consequences:
  positive: []
  negative: []
  risks: []

implementation:
  effort: "medium"
  timeline: ""
  dependencies: []
  blocked_by: []
  tasks: []

relations:
  supersedes: []
  superseded_by: null
  related_to: []
  implements: []
  enables: []

knowledge_extraction:
  keywords: []
  concepts: []
  questions_answered: []
  embedding_priority: "normal"

audit:
  created_at: "${timestamp}"
  last_modified: "${timestamp}"
  version: 1
  changelog:
    - date: "${timestamp}"
      author: "research_agent"
      change: "ADR auto-generated from research validation"
      commit_hash: null
---`;
    }

    /**
     * Generate markdown Context section from research
     */
    static generateContext(research: ResearchData): string {
        const date = new Date().toISOString().split('T')[0];
        const credibilityScore = this.calculateCredibilityScore(research);

        // Group sources by type
        const githubRepos = research.sources.filter(s => s.source === "github");
        const hnPosts = research.sources.filter(s => s.source === "hackernews");
        const soQuestions = research.sources.filter(s => s.source === "stackoverflow");
        const redditPosts = research.sources.filter(s => s.source === "reddit");

        let context = `## Context

### Market Validation (${date})

**Credibility Score**: ${credibilityScore}/10  
**Sources Analyzed**: ${research.sources.length}  
**Research Confidence**: ${(research.confidence * 100).toFixed(0)}%  
**Method**: research_agent (multi-source deep research)

#### Community Demand

`;

        if (githubRepos.length > 0) {
            const avgStars = githubRepos.reduce((sum, r) => sum + (r.stars || 0), 0) / githubRepos.length;
            context += `**GitHub**: ${githubRepos.length} repositories (avg ${Math.round(avgStars)} stars)\n`;
            githubRepos.slice(0, 5).forEach(r => {
                context += `- [${r.title}](${r.url})${r.stars ? ` - ${r.stars} stars` : ''}\n`;
            });
            context += '\n';
        }

        if (hnPosts.length > 0) {
            const totalEngagement = hnPosts.reduce((sum, p) => sum + (p.points || 0), 0);
            context += `**Hacker News**: ${hnPosts.length} discussions (${totalEngagement} total points)\n`;
            hnPosts.slice(0, 5).forEach(p => {
                context += `- [${p.title}](${p.url})${p.points ? ` - ${p.points} points` : ''}\n`;
            });
            context += '\n';
        }

        if (soQuestions.length > 0) {
            context += `**Stack Overflow**: ${soQuestions.length} questions\n`;
            soQuestions.slice(0, 3).forEach(q => {
                context += `- [${q.title}](${q.url})\n`;
            });
            context += '\n';
        }

        if (research.consensus) {
            context += `#### Community Consensus\n\n${research.consensus}\n\n`;
        }

        if (research.factCheck.verified) {
            context += `#### Official Verification\n\n`;
            context += `✅ Verified via official sources (confidence: ${(research.factCheck.confidence * 100).toFixed(0)}%)\n`;
            if (research.factCheck.officialSource) {
                context += `- ${research.factCheck.officialSource}\n`;
            }
            context += '\n';
        }

        context += `**Research Query**: "${research.query}"  \n`;
        context += `**Search Duration**: ${research.searchDuration}ms\n`;

        return context;
    }

    /**
     * Generate complete ADR markdown from research
     */
    static generateADR(research: ResearchData, title: string, project?: string): string {
        const frontmatter = this.toADRFrontmatter(research, title, project);
        const context = this.generateContext(research);

        const placeholderSections = `
## Decision

[Describe the architectural decision here based on the research findings]

## Rationale

### Drivers

${research.recommendations.map(r => `- ${r}`).join('\n')}

### Alternatives Considered

[Document alternative approaches based on research]

### Trade-offs

[List accepted trade-offs]

## Consequences

### Positive

- Strong community validation (credibility: ${this.calculateCredibilityScore(research)}/10)
- ${research.sources.length} sources supporting this approach

### Negative

[Document potential negative consequences]

### Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| [Risk] | medium | medium | [Mitigation] |

## Implementation

### Tasks

- [ ] Review research findings
- [ ] Validate with team
- [ ] Create implementation plan

### Timeline

[Estimate based on complexity]

## References

### Research Sources

${research.sources.map((s, i) => `${i + 1}. [${s.title}](${s.url}) (${s.source}, credibility: ${s.credibility})`).join('\n')}
`;

        return `${frontmatter}\n\n${context}\n${placeholderSections}`;
    }
}
