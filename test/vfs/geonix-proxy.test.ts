/**
 * Geonix: HTTP vs SOCKS ports per API docs; list type normalization.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  geonixServerFromItem,
  geonixCredentialsFromItem,
  geonixConnectionHost,
  normalizeGeonixListType,
  proxyServerArg,
} from '../../src/lib/geonixProxy.js';
import type { GeonixProxyItem } from '../../src/lib/geonixProxy.js';

describe('geonix proxy endpoint', () => {
  it('uses HTTP port only when port_http > 0', () => {
    const item = {
      ip: '1.2.3.4',
      port_http: 59100,
      port_socks: 443,
    } as GeonixProxyItem;
    assert.deepStrictEqual(geonixServerFromItem(item), {
      server: '1.2.3.4:59100',
      kind: 'http',
    });
  });

  it('prefers ip over auth_ip for proxy host (auth_ip is often whitelist metadata)', () => {
    const item = {
      ip: '72.56.156.10',
      auth_ip: '82.27.201.74',
      port_http: 59100,
      port_socks: 443,
    } as GeonixProxyItem;
    assert.strictEqual(geonixConnectionHost(item), '72.56.156.10');
    assert.deepStrictEqual(geonixServerFromItem(item), {
      server: '72.56.156.10:59100',
      kind: 'http',
    });
  });

  it('falls back to auth_ip when ip is empty', () => {
    const item = {
      ip: '',
      auth_ip: '82.27.201.74',
      port_http: 59100,
      port_socks: 0,
    } as GeonixProxyItem;
    assert.strictEqual(geonixConnectionHost(item), '82.27.201.74');
  });

  it('uses SOCKS5 URL when port_http is 0 but port_socks > 0', () => {
    const item = {
      ip: '1.2.3.4',
      port_http: 0,
      port_socks: 59100,
    } as GeonixProxyItem;
    assert.deepStrictEqual(geonixServerFromItem(item), {
      server: 'socks5://1.2.3.4:59100',
      kind: 'socks5',
    });
  });

  it('reads login/password from item', () => {
    const item = { login: ' u ', password: ' p ' } as GeonixProxyItem;
    assert.deepStrictEqual(geonixCredentialsFromItem(item), { username: 'u', password: 'p' });
  });

  it('normalizeGeonixListType defaults invalid to ipv4', () => {
    assert.strictEqual(normalizeGeonixListType(undefined), 'ipv4');
    assert.strictEqual(normalizeGeonixListType('mobile'), 'mobile');
    assert.strictEqual(normalizeGeonixListType('bogus'), 'ipv4');
  });

  it('proxyServerArg passes through socks5 and http URLs', () => {
    assert.strictEqual(proxyServerArg('socks5://h:1'), '--proxy-server=socks5://h:1');
    assert.strictEqual(proxyServerArg('1.2.3.4:80'), '--proxy-server=http://1.2.3.4:80');
  });
});
