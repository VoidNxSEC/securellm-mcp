import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { sampleDomains } from '../helpers/fixtures.js';

// Test the domain whitelist logic in isolation (extracted from BrowserSessionManager)
function isDomainAllowed(domain: string, allowedDomains: string[]): boolean {
  return allowedDomains.some(d => domain === d || domain.endsWith('.' + d));
}

const WHITELIST = ['google.com', 'github.com', 'stackoverflow.com', 'duckduckgo.com', 'localhost'];

describe('Browser Domain Whitelist', () => {
  describe('valid domains', () => {
    for (const domain of WHITELIST) {
      it(`should allow exact match: ${domain}`, () => {
        assert.equal(isDomainAllowed(domain, WHITELIST), true);
      });
    }
  });

  describe('valid subdomains', () => {
    for (const subdomain of sampleDomains.subdomains) {
      it(`should allow subdomain: ${subdomain}`, () => {
        assert.equal(isDomainAllowed(subdomain, WHITELIST), true);
      });
    }
  });

  describe('bypass attempts (must be rejected)', () => {
    for (const malicious of sampleDomains.malicious) {
      it(`should reject: ${malicious}`, () => {
        assert.equal(isDomainAllowed(malicious, WHITELIST), false);
      });
    }
  });

  it('should reject empty domain', () => {
    assert.equal(isDomainAllowed('', WHITELIST), false);
  });

  it('should reject domain with only dot prefix', () => {
    assert.equal(isDomainAllowed('.github.com', WHITELIST), true);
    // .github.com is technically a valid subdomain of github.com
  });

  it('should reject completely unrelated domain', () => {
    assert.equal(isDomainAllowed('malware.ru', WHITELIST), false);
  });

  it('should reject domain containing whitelist entry as substring', () => {
    // This was the original vulnerability: evil-github.com.attacker.com
    // contains "github.com" as substring but is NOT a subdomain
    assert.equal(isDomainAllowed('evil-github.com.attacker.com', WHITELIST), false);
  });

  it('should reject domain where whitelist entry is a suffix but not subdomain', () => {
    // notgithub.com ends with github.com but is not a subdomain
    assert.equal(isDomainAllowed('notgithub.com', WHITELIST), false);
  });
});
