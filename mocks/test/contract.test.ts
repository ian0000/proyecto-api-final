import { describe, expect, it } from 'vitest';
import SwaggerParser from '@apidevtools/swagger-parser';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { fileURLToPath } from 'node:url';
import { outcome } from '../src/app.js';
import { scenarios } from '../../shared/domain.js';

describe('published financial mock contracts', () => {
  it('validates OpenAPI, sample submission and every generated scenario result', async () => {
    const path = fileURLToPath(new URL('../../shared/mocks-openapi.json', import.meta.url));
    const document = await SwaggerParser.validate(path);
    expect(Object.keys(document.paths ?? {})).toHaveLength(7);
    const resolved = (await SwaggerParser.dereference(path)) as {
      components: { schemas: Record<string, object> };
    };
    const ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);
    const submission = ajv.compile(resolved.components.schemas.JsonSubmission);
    const result = ajv.compile(resolved.components.schemas.BankResult);
    const base = {
      applicationId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      principalCents: 2100000,
      downPaymentCents: 900000,
      termMonths: 48,
      scenario: 'aprobada' as const,
      callbackUrl: 'http://127.0.0.1:4000/v1/webhooks/financieras/pichincha',
    };
    expect(submission(base), JSON.stringify(submission.errors)).toBe(true);
    expect(submission({ ...base, termMonths: 13 })).toBe(false);
    for (const bank of ['pichincha', 'pacifico'] as const)
      for (const scenario of scenarios)
        expect(
          result(outcome(bank, { ...base, scenario }, 'contract-test')),
          JSON.stringify(result.errors),
        ).toBe(true);
  });
});
