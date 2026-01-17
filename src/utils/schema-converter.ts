import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Converts a Zod schema to an MCP-compliant JSON Schema object.
 * Removes the '$schema' field and ensures strict typing.
 */
export function zodToMcpSchema(schema: z.ZodType<any>) {
  const jsonSchema = zodToJsonSchema(schema, { target: 'jsonSchema7' });
  
  // The root of the schema from zod-to-json-schema might contain $schema or definitions
  // which we might want to clean up for strictly embedded usage, but usually
  // passing the object directly works if it's type: object.
  
  // If the result is a definition wrapper, extract the main type
  // This is a simplified handler.
  const { $schema, definitions, ...rest } = jsonSchema as any;
  
  return rest;
}
