// Pure rules for what stays on the device (design section 7). No imports and no globals, so
// node:test can load this file as is and authActions.ts / outbox.ts share the same logic.

// Purge decision for supabase-js onAuthStateChange. The purge removes data the next user must
// not see; it must never fire on a mere network failure, or a walker with an expired token
// working offline would lose the day agenda.
//  - SIGNED_OUT (explicit sign-out or a definitive refresh rejection): always.
//  - INITIAL_SESSION without a session: only online, with the stored token gone and a user that
//    was logged in. `loggedIn` must be the real "true" flag, so a fresh visitor never reloads.
export function shouldPurge({ event, session, online, hasToken, loggedIn }) {
  if (event === 'SIGNED_OUT') return true
  return event === 'INITIAL_SESSION' && !session && online !== false && !hasToken && !!loggedIn
}

const OURS = /^(muten:|dd:)/

// Removes every muten:* and dd:* key (stores, outbox, caches). Returns the removed keys.
export function purgeKeys(storage) {
  const doomed = []
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k && OURS.test(k)) doomed.push(k)
  }
  doomed.forEach((k) => storage.removeItem(k))
  return doomed
}

// Splits the outbox: ops of the current user (replayable) and the parked ones (another user, or
// queued before ops carried a user). Parked ops are kept, invisible and never replayed.
export function opsFor(ops, uid) {
  if (!Array.isArray(ops)) return { mine: [], parked: [] }
  const mine = []
  const parked = []
  for (const op of ops) (uid && op && op.uid === uid ? mine : parked).push(op)
  return { mine, parked }
}

// Outcome of a PostgREST response ({ error, status }):
//  ok | network (nothing reached the server: keep the queue) | auth (expired session: keep the
//  queue, sign in again) | rejected (the server refused this op: surface it and move on).
export function classify(res) {
  const err = res && res.error
  if (!err) return 'ok'
  const status = res.status || 0
  if (status === 401 || err.code === 'PGRST301' || /jwt/i.test(err.message || '')) return 'auth'
  if (!err.code && !status) return 'network'
  return 'rejected'
}

// Reads a whole PostgREST list past the server's row cap (1000 on Supabase), one .range() page at a time.
// `build` returns a FRESH query (a builder runs once) whose order ends in a unique column, so pages neither
// overlap nor skip rows. An error on any page is returned as the error: never a silently partial list.
export function pageAll(build, size = 1000) {
  const out = []
  const step = (from) => build().range(from, from + size - 1).then((res) => {
    if (res && res.error) return { data: null, error: res.error }
    const rows = (res && res.data) || []
    out.push(...rows)
    return rows.length < size ? { data: out, error: null } : step(from + size)
  })
  return step(0)
}
