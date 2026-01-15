import fastJson from 'fast-json-stringify';

// Schema for tool responses (ex: Nix package search)
const toolResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      additionalProperties: true,
    },
    metadata: {
      type: 'object',
      properties: {
        timestamp: { type: 'string' },
        duration_ms: { type: 'number' },
      },
    },
  },
};

export const stringifyToolResponse = fastJson(toolResponseSchema);

// Schema for knowledge entries
const knowledgeEntrySchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      session_id: { type: 'string' },
      type: { type: 'string' },
      content: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true },
      timestamp: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
  },
};

export const stringifyKnowledgeEntries = fastJson(knowledgeEntrySchema);

// Generic fallback (fast object stringify)
export const stringifyGeneric = fastJson({
  type: 'object',
  additionalProperties: true,
});
