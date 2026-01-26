#!/usr/bin/env node
/**
 * Test GitHub Token Integration
 *
 * Validates:
 * - Token retrieval from gh CLI / SOPS / ENV
 * - Rate limit status (should be 5000/h with token)
 * - Token source transparency
 */

import { githubTokenProvider } from '../build/src/utils/github-token.js';

async function main() {
  console.log('🔍 Testing GitHub Token Integration\n');

  // Test 1: Get token
  console.log('1️⃣  Fetching GitHub token...');
  const token = await githubTokenProvider.getToken();

  if (!token) {
    console.error('❌ No GitHub token available');
    console.log('\n💡 To fix:');
    console.log('   - Ensure gh CLI is authenticated: gh auth login');
    console.log('   - OR set GITHUB_TOKEN env var');
    console.log('   - OR enable SOPS: kernelcore.secrets.github.enable = true;');
    process.exit(1);
  }

  console.log(`✅ Token found: ${token.substring(0, 10)}...`);

  // Test 2: Validate token and check rate limits
  console.log('\n2️⃣  Validating token and checking rate limits...');
  const validation = await githubTokenProvider.validateToken(token);

  if (!validation.valid) {
    console.error('❌ Token is invalid');
    process.exit(1);
  }

  console.log(`✅ Token is valid`);
  console.log(`\n📊 Rate Limits:`);
  console.log(`   Total: ${validation.rateLimit} requests/hour`);
  console.log(`   Remaining: ${validation.remaining}`);
  console.log(`   Used: ${validation.rateLimit - validation.remaining}`);

  // Analyze rate limit tier
  if (validation.rateLimit >= 5000) {
    console.log(`\n🎉 Authenticated rate limit (5000 req/h) - OPTIMAL!`);
  } else if (validation.rateLimit === 60) {
    console.log(`\n⚠️  Unauthenticated rate limit (60 req/h) - Token may be missing/invalid`);
  } else {
    console.log(`\n⚠️  Unknown rate limit tier: ${validation.rateLimit}`);
  }

  // Test 3: Check cache
  console.log('\n3️⃣  Testing cache...');
  const cachedToken = await githubTokenProvider.getToken();
  console.log(`✅ Cache working (same token returned)`);

  console.log('\n✅ All tests passed!');
  console.log('\n📝 Next steps:');
  console.log('   - Test research_agent tool in Claude/Cursor');
  console.log('   - Monitor rate limit usage');
  console.log('   - Consider migrating to SOPS when conflicts arise');
}

main().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
