import SwaggerParser from '@apidevtools/swagger-parser';
import { readFile } from 'node:fs/promises';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { resolve } from 'node:path';
const document = await SwaggerParser.validate(resolve('shared/openapi.json'));
const dereferenced = (await SwaggerParser.dereference(resolve('shared/openapi.json'))) as {
  components: { schemas: Record<string, object> };
};
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(dereferenced.components.schemas.ApplicationInput);
if (!validate(JSON.parse(await readFile('shared/example.json', 'utf8'))))
  throw new Error(JSON.stringify(validate.errors));
console.log(
  `OpenAPI ${'openapi' in document ? document.openapi : ''} valid; ${Object.keys(document.paths ?? {}).length} paths; canonical example valid.`,
);
const mocks = await SwaggerParser.validate(resolve('shared/mocks-openapi.json'));
console.log(
  `Financial mocks OpenAPI valid; ${Object.keys(mocks.paths ?? {}).length} paths (JSON/webhook and XML/polling).`,
);
