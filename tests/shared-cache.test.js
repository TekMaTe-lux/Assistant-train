const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { TextEncoder, TextDecoder } = require('node:util');

const projectRoot = path.resolve(__dirname, '..');
const handlerPath = path.join(projectRoot, 'api', 'trainsauv.js');
const handlerSource = fs.readFileSync(handlerPath, 'utf8');

function createFetchStub() {
  const state = {
    githubGetCalls: 0,
    githubPutCalls: 0,
    apiCalls: 0,
    githubContent: null,
    githubSha: null
  };

  let shaCounter = 1;

  function buildResponse({ status, ok, jsonData }) {
    const statusText = ok ? 'OK' : 'Error';
    return {
      ok,
      status,
      statusText,
      async json() {
        return jsonData;
      },
      async text() {
        return typeof jsonData === 'string' ? jsonData : JSON.stringify(jsonData);
      },
      headers: new Map()
    };
  }

  async function fetch(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();

    if (url.includes('api.github.com')) {
      if (method === 'GET') {
        state.githubGetCalls += 1;
        if (!state.githubContent) {
          return buildResponse({ status: 404, ok: false, jsonData: { message: 'Not Found' } });
        }

        return buildResponse({
          status: 200,
          ok: true,
          jsonData: {
            content: Buffer.from(state.githubContent, 'utf8').toString('base64'),
            encoding: 'base64',
            sha: state.githubSha
          }
        });
      }

      if (method === 'PUT') {
        state.githubPutCalls += 1;
        const body = JSON.parse(options.body || '{}');
        const decoded = Buffer.from(body.content || '', 'base64').toString('utf8');
        state.githubContent = decoded;
        state.githubSha = `sha${shaCounter++}`;

        return buildResponse({
          status: 200,
          ok: true,
          jsonData: {
            content: { sha: state.githubSha }
          }
        });
      }
    }

    if (url.startsWith('https://api.sncf.com')) {
      state.apiCalls += 1;
      const payload = { requestId: `call-${state.apiCalls}` };
      return buildResponse({ status: 200, ok: true, jsonData: payload });
    }

    throw new Error(`Unhandled fetch request for ${url}`);
  }

  return { fetch, state };
}

function createMockResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: undefined,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return payload;
    },
    end() {
      this.ended = true;
      return this;
    }
  };
}

async function createHandler(fetchImpl) {
  const transformedSource = handlerSource.replace(
    'export default async function handler',
    'async function handler'
  ) + '\nmodule.exports = handler;\n';

  const sandbox = {
    console,
    process,
    Buffer,
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    module: { exports: {} },
    exports: {},
    require,
    __filename: handlerPath,
    __dirname: path.dirname(handlerPath)
  };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox, { name: 'sncf-shared-cache-test' });
  const script = new vm.Script(transformedSource, { filename: handlerPath });
  script.runInContext(context);
  return context.module.exports;
}

function withEnv(overrides) {
  const keys = Object.keys(overrides);
  const previous = new Map();
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(process.env, key)) {
      previous.set(key, process.env[key]);
    }
    process.env[key] = overrides[key];
  }

  return () => {
    for (const key of keys) {
      if (previous.has(key)) {
        process.env[key] = previous.get(key);
      } else {
        delete process.env[key];
      }
    }
  };
}

test('shared GitHub cache is reused across independent requests', async () => {
  const restoreEnv = withEnv({
    SNCF_KEY: 'test-key',
    GITHUB_TOKEN: 'gh-token',
    GITHUB_OWNER: 'owner',
    GITHUB_REPO: 'owner/repo'
  });

  try {
    const { fetch, state } = createFetchStub();
    const handler = await createHandler(fetch);

    const firstResponse = createMockResponse();
    const firstPayload = await handler(
      { method: 'GET', query: { id: 'journeys', ttl: '300' } },
      firstResponse
    );

    assert.equal(firstResponse.statusCode, 200, 'first request should succeed');
    assert.equal(firstResponse.headers['X-Sncf-Cache-State'], 'MISS');
    assert.equal(firstResponse.headers['X-Sncf-Usage-Requests'], '1');
    assert.equal(firstResponse.headers['X-Sncf-Usage-ApiRequests'], '1');
    assert.equal(firstResponse.headers['X-Sncf-Usage-CacheHits'], '0');
    assert.equal(
      firstResponse.headers['Access-Control-Expose-Headers'],
      [
        'X-Sncf-Cache-State',
        'X-Sncf-Cache-Expires',
        'X-Sncf-Usage-Date',
        'X-Sncf-Usage-Requests',
        'X-Sncf-Usage-ApiRequests',
        'X-Sncf-Usage-CacheHits',
        'X-Sncf-Usage-Updated-At',
        'X-Sncf-Usage-Quota',
        'X-Sncf-Usage-Remaining'
      ].join(', '),
      'CORS headers should expose shared usage metadata'
    );
    assert.equal(state.apiCalls, 1, 'API should be called once on cache miss');
    assert.equal(firstPayload.requestId, 'call-1');

    const secondResponse = createMockResponse();
    const secondPayload = await handler(
      { method: 'GET', query: { id: 'journeys', ttl: '300' } },
      secondResponse
    );

    assert.equal(secondResponse.statusCode, 200, 'second request should succeed');
    assert.equal(secondResponse.headers['X-Sncf-Cache-State'], 'HIT');
    assert.equal(secondResponse.headers['X-Sncf-Usage-Requests'], '2');
    assert.equal(secondResponse.headers['X-Sncf-Usage-ApiRequests'], '1');
    assert.equal(secondResponse.headers['X-Sncf-Usage-CacheHits'], '1');
    assert.equal(state.apiCalls, 1, 'API should not be called again on cache hit');
    assert.equal(
      secondPayload.requestId,
      firstPayload.requestId,
      'cached payload should match original response'
    );

    assert.equal(state.githubGetCalls, 2, 'GitHub cache should be read for each request');
    assert.equal(state.githubPutCalls, 2, 'GitHub cache should be updated for miss and hit usage');
  } finally {
    restoreEnv();
  }
});
test('shared usage counters advance across three independent clients', async () => {
  const restoreEnv = withEnv({
    SNCF_KEY: 'test-key',
    GITHUB_TOKEN: 'gh-token',
    GITHUB_OWNER: 'owner',
    GITHUB_REPO: 'owner/repo'
  });

  try {
    const { fetch, state } = createFetchStub();
    const handler = await createHandler(fetch);

    const firstResponse = createMockResponse();
    await handler({ method: 'GET', query: { id: 'journeys', ttl: '300' } }, firstResponse);

    assert.equal(firstResponse.headers['X-Sncf-Cache-State'], 'MISS');
    assert.equal(firstResponse.headers['X-Sncf-Usage-Requests'], '1');
    assert.equal(firstResponse.headers['X-Sncf-Usage-ApiRequests'], '1');
    assert.equal(firstResponse.headers['X-Sncf-Usage-CacheHits'], '0');

    const secondResponse = createMockResponse();
    await handler({ method: 'GET', query: { id: 'journeys', ttl: '300' } }, secondResponse);

    assert.equal(secondResponse.headers['X-Sncf-Cache-State'], 'HIT');
    assert.equal(secondResponse.headers['X-Sncf-Usage-Requests'], '2');
    assert.equal(secondResponse.headers['X-Sncf-Usage-ApiRequests'], '1');
    assert.equal(secondResponse.headers['X-Sncf-Usage-CacheHits'], '1');

    const thirdResponse = createMockResponse();
    await handler({ method: 'GET', query: { id: 'journeys', ttl: '300' } }, thirdResponse);

    assert.equal(thirdResponse.headers['X-Sncf-Cache-State'], 'HIT');
    assert.equal(thirdResponse.headers['X-Sncf-Usage-Requests'], '3');
    assert.equal(thirdResponse.headers['X-Sncf-Usage-ApiRequests'], '1');
    assert.equal(thirdResponse.headers['X-Sncf-Usage-CacheHits'], '2');

    assert.equal(state.apiCalls, 1, 'API should only be called once across three clients');
    assert.equal(state.githubGetCalls, 3, 'GitHub cache should be read for each client');
    assert.equal(state.githubPutCalls, 3, 'GitHub cache should persist usage for each response');
    
    const persisted = JSON.parse(state.githubContent || '{}');
    assert.equal(
      persisted?.usage?.userRequests,
      3,
      'GitHub usage counter should match total requests across clients'
    );
    assert.equal(
      persisted?.usage?.apiRequests,
      1,
      'GitHub should record a single upstream API call across clients'
    );
    assert.equal(
      persisted?.usage?.cacheHits,
      2,
      'GitHub usage should show two cache hits for the later clients'
    );
  } finally {
    restoreEnv();
  }
});
