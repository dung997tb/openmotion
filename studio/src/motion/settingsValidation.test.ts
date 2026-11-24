// @vitest-environment node
import { expect, it } from 'vitest';
import { apiKeyError, apiUrlError, defaultParameters, modelIdError, providerNameError } from './settingsValidation';

it.each([
  ['https://api.example.com/v1', true],
  ['https://api.example.com:443/v2/', true],
  ['https://api.example.com:8443', false],
  ['', false],
  ['not a url', false],
  ['http://api.example.com', false],
  ['https://user:pass@api.example.com', false],
  ['https://api.example.com/?key=x', false],
  ['https://api.example.com/#section', false],
  ['https://api.example.com/a%2fb', false],
  ['https://api.example.com/a%5Cb', false],
  ['https://localhost', false],
  ['https://foo.localhost', false],
  ['https://127.1', false],
  ['https://0x7f000001', false],
  ['https://10.1.2.3', false],
  ['https://172.16.0.1', false],
  ['https://172.32.0.1', true],
  ['https://192.168.1.1', false],
  ['https://100.64.0.1', false],
  ['https://169.254.0.1', false],
  ['https://224.0.0.1', false],
  ['https://8.8.8.8', true],
  ['https://[::1]', false],
  ['https://[::ffff:8.8.8.8]', false],
  ['https://[2001:4860:4860::8888]', true],
  [`https://api.example.com/${'a'.repeat(2048)}`, false],
])('validates HTTPS API URL acceptance: %s', (value, accepted) => {
  expect(!apiUrlError(value)).toBe(accepted);
});

it.each([
  ['https://api.example.com', true],
  ['https://api.example.com/v1', true],
  ['https://api.example.com/v1/', true],
  ['https://api.example.com/v2', false],
])('validates origin-only media URL rules: %s', (value, accepted) => {
  expect(!apiUrlError(value, true)).toBe(accepted);
});

it.each(['model', 'MODEL', 'prompt', 'input', 'api_key', 'api-key', 'apiKey', 'authorization', 'headers', 'webhook_url', '__proto__', 'constructor', 'prototype'])('rejects reserved JSON parameter fields: %s', field => {
  const raw = `{"${field}":"test"}`, result = defaultParameters(raw);
  expect(result.field).toBe(field);
  expect(result.error).toBeTruthy();
});

it('allows nested names and JSON whitespace while enforcing serialized size boundaries', () => {
  for (const parameters of [{ nested: { model: 'allowed' } }, { text: '中'.repeat(63989) }]) {
    const result = defaultParameters(JSON.stringify(parameters, null, 2));
    expect(result.error).toBeUndefined();
    expect(result.parameters).toEqual(parameters);
  }
  const result = defaultParameters(JSON.stringify({ text: '中'.repeat(63990) }));
  expect(result.error).toContain('64,000');
});

it('validates provider names, model IDs, and API key boundaries', () => {
  expect(providerNameError('')).toBeTruthy();
  expect(providerNameError('x'.repeat(81))).toBeTruthy();
  expect(providerNameError('OpenDesign')).toBeUndefined();
  expect(modelIdError('')).toBeTruthy();
  expect(modelIdError('bad id')).toBeTruthy();
  expect(modelIdError('opendesign:flux-pro')).toBeUndefined();
  expect(apiKeyError('sk-valid')).toBeUndefined();
  expect(apiKeyError('line1\nline2')).toBeTruthy();
});
