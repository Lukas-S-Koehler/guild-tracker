# Fix Chrome Endless Loading Issue

## Problem
Chrome gets stuck in endless loading state when fetching guilds, but Safari works fine.

The query hangs at:
```
[AuthContext] Fetching guilds for user: ee0f4dd1-838a-46f0-8c3e-0d1230ef44cd
```

And never returns.

## Root Cause
Chrome's aggressive caching and service worker cache is holding onto stale Supabase connection state or cached responses.

## Solution

### Step 1: Clear Chrome's Cache Completely

1. Open Chrome DevTools (F12)
2. Go to **Application** tab
3. In the left sidebar, expand **Storage**
4. Click **"Clear site data"**
5. Check ALL boxes:
   - ✅ Cookies and other site data
   - ✅ Cached images and files
   - ✅ Service workers
   - ✅ IndexedDB
   - ✅ Local storage
   - ✅ Session storage
6. Click **"Clear site data"**
7. **Close Chrome completely** (Cmd+Q or Alt+F4)
8. Reopen Chrome
9. Go to the app
10. Sign in

### Step 2: Hard Refresh

If Step 1 doesn't work:

1. Go to your app in Chrome
2. Press **Ctrl+Shift+R** (Windows) or **Cmd+Shift+R** (Mac)
3. This does a hard refresh bypassing cache

### Step 3: Disable Cache in DevTools

1. Open DevTools (F12)
2. Go to **Network** tab
3. Check **"Disable cache"** checkbox
4. Keep DevTools open
5. Refresh the page

### Step 4: Clear Supabase Client State

If still stuck, add this to clear Supabase client state:

1. Open Chrome Console (F12 → Console tab)
2. Paste this and press Enter:
```javascript
localStorage.clear();
sessionStorage.clear();
indexedDB.databases().then(dbs => dbs.forEach(db => indexedDB.deleteDatabase(db.name)));
location.reload(true);
```

This clears all storage and force reloads.

## Why Safari Works But Chrome Doesn't

- **Safari**: Clears cache more aggressively between sessions
- **Chrome**: Holds onto service workers and cached responses longer
- **Chrome's "Memory Saver"**: Pauses tabs in background, can corrupt connection state

## Permanent Fix (Code Change)

Add a query timeout to prevent infinite hangs:

```typescript
// In AuthContext.tsx, wrap the query with a timeout
const queryWithTimeout = async () => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

  try {
    const { data, error } = await supabase
      .from('guild_members')
      .select(`...`)
      .eq('user_id', currentUser.id)
      .abortSignal(controller.signal);

    clearTimeout(timeoutId);
    return { data, error };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.error('[AuthContext] Query timed out after 10 seconds');
      return { data: null, error: { message: 'Query timeout' } };
    }
    throw error;
  }
};
```

This ensures the query fails fast instead of hanging forever.
