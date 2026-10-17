import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export const contractPath = fileURLToPath(new URL('../../shared/openapi.json', import.meta.url));
export const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as {
  components: { schemas: Record<string, unknown> };
  paths: Record<string, Record<string, Operation>>;
};
interface Parameter {
  name: string;
  in: string;
  required: boolean;
  schema: unknown;
}
interface Operation {
  parameters?: Parameter[];
  requestBody?: { content: Record<string, { schema: unknown }> };
  responses: Record<string, { content?: Record<string, { schema: unknown }> }>;
}
export function expand(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(expand);
  if (schema && typeof schema === 'object') {
    const s = schema as Record<string, unknown>;
    if (typeof s.$ref === 'string')
      return expand(contract.components.schemas[s.$ref.split('/').pop()!]);
    return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, expand(v)]));
  }
  return schema;
}
export function routeSchema(path: string, method: string) {
  const op = contract.paths[path]?.[method.toLowerCase()];
  if (!op) throw new Error(`Contract missing ${method} ${path}`);
  const schema: Record<string, unknown> = {};
  if (op.requestBody) schema.body = expand(op.requestBody.content['application/json'].schema);
  for (const [where, key] of [
    ['path', 'params'],
    ['query', 'querystring'],
  ] as const) {
    const params = op.parameters?.filter((p) => p.in === where) ?? [];
    if (params.length)
      schema[key] = {
        type: 'object',
        additionalProperties: false,
        properties: Object.fromEntries(params.map((p) => [p.name, expand(p.schema)])),
        required: params.filter((p) => p.required).map((p) => p.name),
      };
  }
  // Validate required headers without rejecting standard HTTP headers.
  const headers = op.parameters?.filter((p) => p.in === 'header') ?? [];
  if (headers.length)
    schema.headers = {
      type: 'object',
      properties: Object.fromEntries(headers.map((p) => [p.name.toLowerCase(), expand(p.schema)])),
      required: headers.filter((p) => p.required).map((p) => p.name.toLowerCase()),
    };
  schema.response = Object.fromEntries(
    Object.entries(op.responses)
      .filter(([code, r]) => code !== 'default' && r.content)
      .map(([code, r]) => [code, expand(r.content!['application/json'].schema)]),
  );
  return schema;
}
