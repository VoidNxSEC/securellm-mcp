# GitHub Token Management - Migration Guide

## Current Setup (Phase 1: gh CLI)

**Status:** ✅ Active
**Source:** `gh auth token` command
**Rate Limit:** 5000 req/h
**Convenience:** High

### How it works

The `getGitHubToken()` utility fetches tokens with this priority:

1. **ENV variable** (`GITHUB_TOKEN`) - Testing/override
2. **gh CLI** (`gh auth token`) - **CURRENT PRIMARY**
3. **SOPS** (`/run/secrets/github_token`) - Future migration path

```typescript
import { getGitHubToken } from './utils/github-token.js';

const token = await getGitHubToken();
// Returns token from gh CLI automatically
```

### Advantages

- ✅ Zero configuration required
- ✅ Works immediately with existing gh setup
- ✅ Automatic token refresh when running `gh auth login`
- ✅ Easy local development

### Known Conflicts (Why we'll migrate)

- ❌ **Multi-user environments**: Each user has different tokens
- ❌ **CI/CD pipelines**: May not have gh CLI configured
- ❌ **Production deployments**: Requires gh CLI on server
- ❌ **Token rotation**: Manual process, no centralized management
- ❌ **Scope drift**: Users may authenticate with different scopes

---

## Future Setup (Phase 2: SOPS Integration)

**Status:** 🚧 Prepared, not active
**Trigger:** When conflicts arise in production/CI
**Migration Time:** ~5 minutes

### When to migrate

Migrate to SOPS when you encounter:

1. Token scope mismatches between users
2. Need for automated token rotation
3. CI/CD pipeline failures due to missing gh CLI
4. Production deployment requirements
5. Need for centralized secrets management

### Migration Steps

#### 1. Enable SOPS module in NixOS

```nix
# /etc/nixos/hosts/kernelcore/configuration.nix
kernelcore.secrets.github.enable = true;
```

#### 2. Rebuild NixOS

```bash
sudo nixos-rebuild switch
```

This will decrypt `/etc/nixos/secrets/github.yaml` and mount the token at:
```
/run/secrets/github_token
```

#### 3. Verify SOPS token

```bash
# Check if token is available
cat /run/secrets/github_token

# Test rate limits with SOPS token
curl -H "Authorization: Bearer $(cat /run/secrets/github_token)" \
  -I https://api.github.com/users/marcosfpina | grep -i "x-ratelimit-limit"
# Should show: X-RateLimit-Limit: 5000
```

#### 4. No code changes required!

The `getGitHubToken()` utility automatically detects SOPS:

```typescript
// Priority order (no changes needed):
// 1. ENV (override)
// 2. gh CLI (current)
// 3. SOPS (automatic fallback) ← Will kick in when enabled
```

#### 5. Disable gh CLI (optional)

Once SOPS is working, you can remove gh CLI dependency:

```bash
# Test without gh CLI
which gh && mv $(which gh) $(which gh).backup
node scripts/test-github-token.ts
# Should still show "Token found" from SOPS
```

### SOPS Token Management

#### Updating the token

```bash
# 1. Edit encrypted file
sudo sops /etc/nixos/secrets/github.yaml

# 2. Update github_token field
github_token: ghp_NewTokenHere...

# 3. Rebuild to apply
sudo nixos-rebuild switch
```

#### Token rotation automation

The SOPS infrastructure already supports:
- AGE encryption with dual keys (lines 8-9 in `.sops.yaml`)
- Automatic decryption at boot via `sops-nix`
- File ownership/permissions (mode 0440, owner: kernelcore)

---

## Comparison Matrix

| Feature | gh CLI (Current) | SOPS (Future) |
|---------|------------------|---------------|
| **Setup time** | 0 min (already done) | 5 min (nixos-rebuild) |
| **Token rotation** | Manual (`gh auth login`) | Centralized (edit SOPS) |
| **CI/CD support** | ❌ Requires gh CLI | ✅ Works everywhere |
| **Multi-user** | ❌ Per-user tokens | ✅ Shared token |
| **Production ready** | ⚠️ Development only | ✅ Yes |
| **Scope consistency** | ❌ Varies per user | ✅ Enforced |
| **Audit trail** | ❌ No tracking | ✅ Git history |

---

## Testing Both Approaches

### Test gh CLI (current)

```bash
# Ensure gh is authenticated
gh auth status

# Test token retrieval
cd ~/arch/securellm-mcp
node scripts/test-github-token.ts
# Should show: "Using token from: gh CLI"
```

### Test SOPS (after migration)

```bash
# Enable SOPS module
sudo nvim /etc/nixos/hosts/kernelcore/configuration.nix
# Add: kernelcore.secrets.github.enable = true;

# Rebuild
sudo nixos-rebuild switch

# Test token
node scripts/test-github-token.ts
# Should show: "Using token from: SOPS"
```

### Test ENV override (always works)

```bash
export GITHUB_TOKEN=ghp_TestToken...
node scripts/test-github-token.ts
# Should show: "Using token from: ENV"
unset GITHUB_TOKEN
```

---

## Troubleshooting

### "No GitHub token available"

**Cause:** None of the sources have a token.

**Fix:**
1. Check gh CLI: `gh auth status`
2. Check SOPS: `ls -la /run/secrets/github_token`
3. Check ENV: `echo $GITHUB_TOKEN`

### "Token is invalid"

**Cause:** Token expired or has insufficient scopes.

**Fix (gh CLI):**
```bash
gh auth login --scopes repo,read:org
```

**Fix (SOPS):**
```bash
# Generate new token at: https://github.com/settings/tokens
# Update SOPS:
sudo sops /etc/nixos/secrets/github.yaml
# github_token: ghp_NewToken...
sudo nixos-rebuild switch
```

### "Rate limit still 60/h"

**Cause:** Token not being sent to GitHub API.

**Debug:**
```typescript
import { githubTokenProvider } from './utils/github-token.js';

const token = await githubTokenProvider.getToken();
const validation = await githubTokenProvider.validateToken(token);
console.log('Rate limit:', validation.rateLimit);
// Should be 5000, not 60
```

---

## Decision Tree

```
Need GitHub API access?
│
├─ Development only?
│  └─ ✅ USE gh CLI (current setup)
│
└─ Production / CI / Multi-user?
   └─ ✅ MIGRATE TO SOPS
      1. Enable kernelcore.secrets.github.enable
      2. nixos-rebuild switch
      3. Test with scripts/test-github-token.ts
```

---

## Related Files

- **Token provider**: `src/utils/github-token.ts`
- **Test script**: `scripts/test-github-token.ts`
- **SOPS config**: `/etc/nixos/.sops.yaml` (lines 17-20)
- **NixOS module**: `/etc/nixos/modules/secrets/github.nix`
- **Secret file**: `/etc/nixos/secrets/github.yaml` (encrypted)
- **Runtime mount**: `/run/secrets/github_token` (decrypted, after SOPS enable)

---

## Summary

**Current:** gh CLI provides convenient, zero-config GitHub token access.
**Future:** SOPS provides production-grade, centralized secret management.
**Transition:** Seamless - code already supports both, just enable SOPS when needed.

**Recommendation:** Keep gh CLI for now, migrate to SOPS when you hit production or CI/CD.
