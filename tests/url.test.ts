import { describe, expect, it } from 'vitest';
import { cleanUrl, dedupeKey, isBlocked } from '../lib/url';

// JWT-shaped placeholder; real tokens never belong in fixtures.
const FAKE_JWT = 'eyJ0eXAiOiJKV1QifQ.eyJmYWtlIjp0cnVlfQ.ZmFrZS1zaWduYXR1cmUtZm9yLXRlc3Rz';
const FAKE_KID = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('cleanUrl', () => {
  it('unwraps a Cloudflare Access login and drops the signed meta token', () => {
    const raw =
      `https://acme.cloudflareaccess.com/cdn-cgi/access/login/ci.acme.dev?kid=${FAKE_KID}` +
      `&meta=${FAKE_JWT}&redirect_url=%2Fpipelines%2F42%2Fruns%2F1001`;
    const c = cleanUrl(raw);
    expect(c.isLoginWall).toBe(true);
    expect(c.destination).toBe('https://ci.acme.dev/pipelines/42/runs/1001');
    expect(c.url).not.toContain('eyJ');
    expect(c.url).not.toContain('kid=');
    expect(c.url).not.toContain('meta=');
  });

  it('carries a hash route over to the unwrapped destination', () => {
    const raw =
      `https://acme.cloudflareaccess.com/cdn-cgi/access/login/jobs.acme.dev?meta=${FAKE_JWT}` +
      `&redirect_url=%2F#/job/running/0f1e2d3c4b5a69788796a5b4c3d2e1f0/overview`;
    const c = cleanUrl(raw);
    expect(c.destination).toMatch(/^https:\/\/jobs\.acme\.dev\/#\/job\/running\/0f1e2d3c/);
  });

  it('decodes double-encoded redirect targets', () => {
    const c = cleanUrl('https://auth.acme.dev/login/email?clientId=web&redirectTo=https%253A%252F%252Fapp.acme.dev');
    expect(c.isLoginWall).toBe(true);
    expect(c.destination).toBe('https://app.acme.dev/');
    expect(c.url).toBe('https://auth.acme.dev/login/email?clientId=web');
  });

  it('unwraps a next_url login redirect and drops the tracking id', () => {
    const c = cleanUrl(
      'https://1234567890123456.7.gcp.databricks.com/login.html?next_url=%2Fexplore%2Fdata%2Ffunctions%2Fanalytics%2Freporting%2Ffn_daily_revenue%3Fo%3D1234567890123456&o=1234567890123456&tuuid=00000000-1111-2222-3333-444444444444',
    );
    expect(c.isLoginWall).toBe(true);
    expect(c.destination).toContain('/explore/data/functions/analytics/reporting/fn_daily_revenue');
    expect(c.url).not.toContain('tuuid');
  });

  it('drops tokens from tracking params and shortens long hashes in fragments', () => {
    const c = cleanUrl(
      'https://github.com/acme/billing-service/pull/512/changes#diff-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    );
    expect(c.isLoginWall).toBe(false);
    expect(c.url).toBe('https://github.com/acme/billing-service/pull/512/changes#diff-01234567…');
  });

  it('removes OAuth tokens from fragments and opaque values from queries', () => {
    expect(cleanUrl('https://app.example.com/cb#access_token=abc&state=1').url).toBe('https://app.example.com/cb');
    expect(cleanUrl(`https://x.com/a?t=abc123XYZ&jwt=${FAKE_JWT}`).url).toBe('https://x.com/a?t=abc123XYZ');
    expect(cleanUrl(`https://example.com/reset/${FAKE_JWT}`).url).toBe('https://example.com/reset/:token');
  });

  it('keeps ordinary query params and SPA hash routes', () => {
    expect(cleanUrl('https://staging.acme.dev/inventory/stock-counts?archived=false').url).toBe(
      'https://staging.acme.dev/inventory/stock-counts?archived=false',
    );
    expect(cleanUrl('http://localhost:8081/#/').url).toBe('http://localhost:8081/#/');
    expect(cleanUrl('https://previews.acme.dev/?q=-pp&status=sleeping').isLoginWall).toBe(false);
  });

  it('passes non-web URLs through without query strings', () => {
    expect(cleanUrl('chrome://extensions/?id=abc').url).toBe('chrome://extensions/');
  });
});

describe('dedupeKey', () => {
  it('treats identical login walls as duplicates', () => {
    const a = 'https://auth.acme.dev/login/email?clientId=web&redirectTo=https%253A%252F%252Fapp.acme.dev';
    expect(dedupeKey(a)).toBe(dedupeKey(a));
    expect(dedupeKey(a)).toMatch(/^login→https:\/\/app\.acme\.dev/);
  });

  it('ignores plain anchors but not hash routes', () => {
    expect(dedupeKey('https://nightlies.apache.org/flink/docs/overview/#union')).toBe(
      dedupeKey('https://nightlies.apache.org/flink/docs/overview/'),
    );
    expect(dedupeKey('http://localhost:8081/#/a')).not.toBe(dedupeKey('http://localhost:8081/#/b'));
  });

  it('distinguishes a PR from its changes tab', () => {
    expect(dedupeKey('https://github.com/acme/inventory-service/pull/2160')).not.toBe(
      dedupeKey('https://github.com/acme/inventory-service/pull/2160/changes'),
    );
  });
});

describe('isBlocked', () => {
  const list = ['app.acme.dev', '*.databricks.com'];
  it('matches exact hosts only for plain entries', () => {
    expect(isBlocked('https://app.acme.dev/orders/list', list)).toBe(true);
    expect(isBlocked('https://app.staging.acme.dev/orders/list', list)).toBe(false);
  });
  it('matches subdomains for wildcard entries', () => {
    expect(isBlocked('https://1234567890123456.7.gcp.databricks.com/login.html', list)).toBe(true);
    expect(isBlocked('https://databricks.com/', list)).toBe(true);
    expect(isBlocked('https://notdatabricks.com/', list)).toBe(false);
  });
});
