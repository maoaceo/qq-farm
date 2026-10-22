const test = require('node:test');
const assert = require('node:assert/strict');
const oidc = require('../dist/services/oidc');
const p = { id: 'oidc', name: '妖火', issuer: 'https://yaohuo.me', clientId: 'client', clientSecret: 'test-only-secret', scopes: 'openid profile', pkce: false, tokenAuthMethod: 'client_secret_post' };
const d = { issuer: p.issuer, authorization_endpoint: 'https://yaohuo.me/OAuth/Authorize.aspx', token_endpoint: 'https://yaohuo.me/OAuth/Token.aspx', jwks_uri: 'https://yaohuo.me/OAuth/Jwks.aspx', response_types_supported: ['code'], token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'] };

test('Yaohuo explicit confidential-client compatibility; Google defaults unchanged', async () => {
  const before = { ...process.env }; const originalFetch = global.fetch;
  process.env.AUTH_PUBLIC_URL = 'https://farm.xaitr.com';
  try {
    const url = new URL(oidc.authorize(p, d, 'state', 'nonce', 'verifier'));
    assert.equal(url.searchParams.get('scope'), 'openid profile');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://farm.xaitr.com/api/oauth/oidc/callback');
    assert.equal(url.searchParams.get('nonce'), 'nonce'); assert.equal(url.searchParams.get('state'), 'state');
    assert.equal(url.searchParams.has('code_challenge'), false);
    const defaults = new URL(oidc.authorize({ ...p, pkce: undefined }, d, 'state', 'nonce', 'verifier'));
    assert.equal(defaults.searchParams.get('code_challenge_method'), 'S256');
    global.fetch = async () => ({ ok: true, text: async () => JSON.stringify(d) });
    assert.equal((await oidc.discover(p)).issuer, p.issuer);
    await assert.rejects(oidc.discover({ ...p, pkce: true }));
    let called = false;
    global.fetch = async (url, options) => {
      called = true; assert.equal(url, d.token_endpoint);
      assert.equal(options.body.get('client_secret'), 'test-only-secret');
      assert.equal(options.body.has('code_verifier'), false);
      assert.equal(options.headers.authorization, undefined);
      assert.equal(options.body.get('redirect_uri'), 'https://farm.xaitr.com/api/oauth/oidc/callback');
      return { ok: true, text: async () => '{}' };
    };
    await assert.rejects(oidc.exchange(p, d, 'code', 'nonce', 'verifier'), /Missing ID token/);
    assert.equal(called, true);
    called = false;
    await assert.rejects(oidc.exchange(p, { ...d, token_endpoint_auth_methods_supported: ['client_secret_basic'] }, 'code', 'nonce', 'verifier'), /unsupported/);
    assert.equal(called, false);
    process.env.OIDC_ISSUER = p.issuer; process.env.OIDC_CLIENT_ID = 'client'; process.env.OIDC_CLIENT_SECRET = 'test-only-secret'; process.env.OIDC_NAME = '妖火'; process.env.OIDC_PKCE = 'false'; process.env.OIDC_TOKEN_AUTH_METHOD = 'client_secret_post'; process.env.OIDC_SCOPES = 'openid profile';
    const configured = oidc.providers().find(p => p.id === 'oidc');
    assert.equal(configured.pkce, false); assert.equal(configured.tokenAuthMethod, 'client_secret_post'); assert.equal(configured.name, '妖火');
    process.env.OIDC_TOKEN_AUTH_METHOD = 'invalid'; assert.throws(() => oidc.providers());
  } finally { global.fetch = originalFetch; for (const k of Object.keys(process.env)) if (!(k in before)) delete process.env[k]; Object.assign(process.env, before); }
});
