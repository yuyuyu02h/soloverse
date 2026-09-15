const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.GROQ_API_KEY = 'groq-test-key';
process.env.GEMINI_API_KEY = 'gemini-test-key';
process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
process.env.LLM_PROVIDER_ORDER = 'groq,gemini,openrouter';
process.env.GROQ_MODELS = 'groq-fail';
process.env.GEMINI_MODELS = 'gemini-fail';
process.env.OPENROUTER_MODELS = 'openrouter-ok';
process.env.LLM_REQUEST_INTERVAL_MS = '0';
process.env.LLM_REQUEST_TIMEOUT_MS = '2000';
process.env.LLM_TOTAL_TIMEOUT_MS = '5000';

const calls = [];
const mockServer = http.createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    const body = JSON.parse(raw);
    calls.push({ authorization: req.headers.authorization, body });

    if (body.model === 'groq-fail') {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' });
      return res.end(JSON.stringify({ error: { message: 'test rate limit' } }));
    }
    if (body.model === 'gemini-fail') {
      res.writeHead(503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'test unavailable' } }));
    }
    if (body.model === 'empty-response') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '' } }], usage: { completion_tokens: 120 } }));
    }
    if (body.model === 'broken-json') {
      return res.end(JSON.stringify({ choices: [{ message: { content: '[{"broken":' } }] }));
    }
    if (body.model === 'json-ok') {
      return res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '```json\n[\n\n{"ok":true}\n]\n```' } }] }));
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({
      model: body.model,
      choices: [{ message: { content: body.model === 'groq-ok' ? 'Groq成功' : 'OpenRouter成功' } }],
    }));
  });
});

let baseUrl;

test.before(async () => {
  await new Promise(resolve => mockServer.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${mockServer.address().port}`;
  process.env.GROQ_BASE_URL = baseUrl;
  process.env.GEMINI_BASE_URL = baseUrl;
  process.env.OPENROUTER_BASE_URL = baseUrl;
});

test.after(async () => {
  await new Promise(resolve => mockServer.close(resolve));
});

test('Groq、Geminiの失敗後にOpenRouterへフォールバックする', async () => {
  const { callLLM } = require('../src/services/llm');
  const result = await callLLM('system', '日本語で短く返答してください', 123);

  assert.equal(result, 'OpenRouter成功');
  assert.deepEqual(calls.map(call => call.body.model), ['groq-fail', 'gemini-fail', 'openrouter-ok']);
  assert.equal(calls[0].body.max_completion_tokens, 123);
  assert.equal(calls[0].body.max_tokens, undefined);
  assert.equal(calls[1].body.max_tokens, 123);
  assert.equal(calls[2].body.reasoning.exclude, true);
  assert.deepEqual(calls.map(call => call.authorization), [
    'Bearer groq-test-key',
    'Bearer gemini-test-key',
    'Bearer openrouter-test-key',
  ]);
});

test('Groqが成功した場合は後続プロバイダーを呼ばない', async () => {
  const { callLLM, getModels, isLLMConfigured } = require('../src/services/llm');
  calls.length = 0;
  process.env.GROQ_MODELS = 'groq-ok';

  assert.equal(isLLMConfigured(), true);
  assert.deepEqual(getModels(), [
    'groq:groq-ok',
    'gemini:gemini-fail',
    'openrouter:openrouter-ok',
  ]);
  assert.equal(await callLLM('', '短く返答してください', 80), 'Groq成功');
  assert.deepEqual(calls.map(call => call.body.model), ['groq-ok']);
});

test('空応答のモデルは休止し、次の呼び出しでも繰り返し失敗しない', async () => {
  const { callLLM } = require('../src/services/llm');
  process.env.GROQ_MODELS = 'empty-response,groq-ok';
  calls.length = 0;
  assert.equal(await callLLM('', 'こんにちは'), 'Groq成功');
  assert.equal(await callLLM('', 'こんにちは'), 'Groq成功');
  assert.equal(calls.filter(call => call.body.model === 'empty-response').length, 1);
});

test('壊れたJSONは後続へ切り替え、正常な複数段落のJSONは維持する', async () => {
  const { callLLM } = require('../src/services/llm');
  process.env.GROQ_MODELS = 'broken-json,json-ok';
  calls.length = 0;
  const raw = await callLLM('', 'JSON配列を返してください');
  assert.ok(raw.includes('{"ok":true}'));
  assert.deepEqual(calls.map(call => call.body.model), ['broken-json', 'json-ok']);
});

test('Groq GPT-OSSには推論用の余裕を確保する', async () => {
  const { callLLM } = require('../src/services/llm');
  process.env.GROQ_MODELS = 'openai/gpt-oss-120b';
  calls.length = 0;
  await callLLM('', 'こんにちは', 80);
  assert.equal(calls[0].body.reasoning_effort, 'low');
  assert.equal(calls[0].body.include_reasoning, false);
  assert.ok(calls[0].body.max_completion_tokens >= 1024);
});

test('APIキーが一つもなければ明示的に失敗する', async () => {
  const { callLLM, isLLMConfigured } = require('../src/services/llm');
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;

  assert.equal(isLLMConfigured(), false);
  await assert.rejects(() => callLLM('', 'test'), /LLM APIキーが設定されていません/);
});
