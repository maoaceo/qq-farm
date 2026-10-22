import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
export interface OidcProvider { id: string; name: string; issuer: string; clientId: string; clientSecret: string; scopes: string; pkce?: boolean; tokenAuthMethod?: 'auto' | 'client_secret_basic' | 'client_secret_post'; }
export function publicOrigin(): string {
    const u = new URL(process.env.AUTH_PUBLIC_URL || '');
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) throw new Error('AUTH_PUBLIC_URL requires HTTPS (except localhost)');
    if (u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('AUTH_PUBLIC_URL must be an origin without path');
    return u.origin;
}
export function providers(): OidcProvider[] {
    const result: OidcProvider[] = [];
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) result.push({ id: 'google', name: 'Google', issuer: 'https://accounts.google.com', clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, scopes: 'openid email profile' });
    if (process.env.OIDC_TOKEN_AUTH_METHOD && !['auto', 'client_secret_basic', 'client_secret_post'].includes(process.env.OIDC_TOKEN_AUTH_METHOD)) throw new Error('Invalid OIDC token authentication method');
    if (process.env.OIDC_PKCE && !['true', 'false'].includes(process.env.OIDC_PKCE)) throw new Error('Invalid OIDC_PKCE');
    if (process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET) result.push({ id: 'oidc', name: process.env.OIDC_NAME || 'OIDC', issuer: process.env.OIDC_ISSUER, clientId: process.env.OIDC_CLIENT_ID, clientSecret: process.env.OIDC_CLIENT_SECRET, scopes: process.env.OIDC_SCOPES || 'openid profile', pkce: process.env.OIDC_PKCE !== 'false', tokenAuthMethod: (process.env.OIDC_TOKEN_AUTH_METHOD || 'auto') as OidcProvider['tokenAuthMethod'] });
    if (result.length) publicOrigin();
    return result;
}
export function callbackUrl(p: OidcProvider): string { return `${publicOrigin()}/api/oauth/${p.id}/callback`; }
function httpsUrl(value: string): URL { const u = new URL(value); if (u.protocol !== 'https:' || u.username || u.password || u.hash) throw new Error('OIDC endpoints require HTTPS'); return u; }
async function jsonFetch(url: string, options: any = {}): Promise<any> {
    httpsUrl(url);
    const res = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error('OIDC endpoint rejected request');
    const text = await res.text(); if (text.length > 1024 * 1024) throw new Error('OIDC response too large');
    return JSON.parse(text);
}
export async function discover(p: OidcProvider): Promise<any> {
    httpsUrl(p.issuer);
    const d = await jsonFetch(`${p.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
    if (d.issuer !== p.issuer || !d.response_types_supported?.includes('code') || (p.pkce !== false && !d.code_challenge_methods_supported?.includes('S256'))) throw new Error('Unsupported OIDC issuer or PKCE');
    for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) httpsUrl(d[key]);
    return d;
}
export function random(): string { return crypto.randomBytes(32).toString('base64url'); }
export function challenge(verifier: string): string { return crypto.createHash('sha256').update(verifier).digest('base64url'); }
export function authorize(p: OidcProvider, d: any, state: string, nonce: string, verifier: string): string {
    const u = new URL(d.authorization_endpoint);
    for (const [key, value] of Object.entries({ response_type: 'code', client_id: p.clientId, redirect_uri: callbackUrl(p), scope: p.scopes, state, nonce })) u.searchParams.set(key, value);
    if (p.pkce !== false) { u.searchParams.set('code_challenge', challenge(verifier)); u.searchParams.set('code_challenge_method', 'S256'); }
    return u.toString();
}
export async function verifyIdentity(p: OidcProvider, d: any, idToken: string, nonce: string): Promise<{ issuer: string; subject: string }> {
    return verifySignedIdentity(p, idToken, nonce, createRemoteJWKSet(new URL(d.jwks_uri), { timeoutDuration: 10_000 }));
}
export async function verifySignedIdentity(p: OidcProvider, idToken: string, nonce: string, key: ReturnType<typeof createRemoteJWKSet>): Promise<{ issuer: string; subject: string }> {
    const { payload } = await jwtVerify(idToken, key, { issuer: p.issuer, audience: p.clientId, algorithms: ['RS256', 'ES256'], requiredClaims: ['exp', 'iat', 'sub', 'nonce'], clockTolerance: 5, maxTokenAge: '10m' });
    if (payload.nonce !== nonce || typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 1024) throw new Error('Invalid OIDC identity');
    if ((Array.isArray(payload.aud) && payload.aud.length > 1) || payload.azp !== undefined) { if (payload.azp !== p.clientId) throw new Error('Invalid authorized party'); }
    return { issuer: p.issuer, subject: payload.sub };
}
export async function exchange(p: OidcProvider, d: any, code: string, nonce: string, verifier: string): Promise<{ issuer: string; subject: string }> {
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callbackUrl(p), client_id: p.clientId });
    if (p.pkce !== false) body.set('code_verifier', verifier);
    const methods: string[] = d.token_endpoint_auth_methods_supported || ['client_secret_basic'];
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
    const method = p.tokenAuthMethod && p.tokenAuthMethod !== 'auto' ? p.tokenAuthMethod : methods.includes('client_secret_basic') ? 'client_secret_basic' : 'client_secret_post';
    if (!methods.includes(method)) throw new Error('Configured token auth method unsupported by provider');
    if (method === 'client_secret_basic') {
        const encode = (s: string) => new URLSearchParams({ x: s }).toString().slice(2);
        headers.authorization = `Basic ${Buffer.from(`${encode(p.clientId)}:${encode(p.clientSecret)}`).toString('base64')}`;
    } else if (method === 'client_secret_post') body.set('client_secret', p.clientSecret);
    else throw new Error('Unsupported OIDC token auth method');
    const token = await jsonFetch(d.token_endpoint, { method: 'POST', headers, body });
    if (typeof token.id_token !== 'string') throw new Error('Missing ID token');
    return verifyIdentity(p, d, token.id_token, nonce);
}
