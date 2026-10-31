// S6: pure rules behind the end-of-session purge and the offline outbox (design section 7).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, opsFor, pageAll, purgeKeys, shouldPurge } from '../../src/lib/localData.js'

const base = { event: 'INITIAL_SESSION', session: null, online: true, hasToken: false, loggedIn: true }

test('shouldPurge: SIGNED_OUT always purges, INITIAL_SESSION only when it is a definitive logout', () => {
  const table = [
    ['SIGNED_OUT online', { event: 'SIGNED_OUT' }, true],
    ['SIGNED_OUT offline', { event: 'SIGNED_OUT', online: false }, true],
    ['SIGNED_OUT with a stale session object', { event: 'SIGNED_OUT', session: { access_token: 'x' } }, true],
    ['start online, no session, token gone, was logged in', {}, true],
    ['offline start with the token gone (never purge)', { online: false }, false],
    ['offline start with an expired token kept in storage', { online: false, hasToken: true }, false],
    ['online start, no session but the token is still stored (network blip)', { hasToken: true }, false],
    ['online start, nobody was logged in (fresh visitor, avoids a reload loop)', { loggedIn: false }, false],
    ['start with a live session', { session: { access_token: 'x' } }, false],
    ['SIGNED_IN', { event: 'SIGNED_IN', session: { access_token: 'x' } }, false],
    ['TOKEN_REFRESHED', { event: 'TOKEN_REFRESHED', session: { access_token: 'x' } }, false],
    ['unknown event without a session', { event: 'USER_UPDATED' }, false],
  ]
  for (const [name, patch, want] of table) assert.equal(shouldPurge({ ...base, ...patch }), want, name)
})

function fakeStorage(entries) {
  const m = new Map(Object.entries(entries))
  return {
    get length() { return m.size },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    removeItem: (k) => m.delete(k),
    keys: () => [...m.keys()].sort(),
  }
}

test('purgeKeys removes every muten:* and dd:* key and nothing else', () => {
  const s = fakeStorage({
    'muten:auth:userId': '"u"', 'muten:grupos:grupos': '[]', 'dd:outbox': '[]', 'dd:other': '1',
    'sb-ref-auth-token': '{}', 'theme': 'dark', 'mutenx:no': '1', 'xdd:no': '1',
  })
  const removed = purgeKeys(s)
  assert.deepEqual(removed.sort(), ['dd:other', 'dd:outbox', 'muten:auth:userId', 'muten:grupos:grupos'])
  assert.deepEqual(s.keys(), ['mutenx:no', 'sb-ref-auth-token', 'theme', 'xdd:no'])
  assert.deepEqual(purgeKeys(s), [], 'idempotent')
})

test('opsFor splits the queue into the current user ops and the parked ones, keeping order', () => {
  const op = (uid, n) => ({ kind: 'rpc', name: 'paseo_marcar', params: { n }, uid })
  const q = [op('a', 1), op('b', 2), op('a', 3), { kind: 'rpc', name: 'x', params: {} }]
  const r = opsFor(q, 'a')
  assert.deepEqual(r.mine.map((o) => o.params.n), [1, 3])
  assert.deepEqual(r.parked.length, 2)
  assert.deepEqual(opsFor(q, '').mine, [], 'no user id replays nothing')
  assert.deepEqual(opsFor(q, null).mine, [])
  assert.deepEqual(opsFor('not a list', 'a'), { mine: [], parked: [] })
})

test('classify tells a network failure from an auth failure and a server rejection', () => {
  const table = [
    ['no error', { error: null, status: 204 }, 'ok'],
    ['undefined response', undefined, 'ok'],
    ['fetch failed (postgrest-js: empty code)', { error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 }, 'network'],
    ['no code, no status', { error: { message: 'x' } }, 'network'],
    ['expired JWT', { error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 }, 'auth'],
    ['401 without code', { error: { code: 'PGRST303', message: 'nope' }, status: 401 }, 'auth'],
    ['JWT message', { error: { code: 'XX', message: 'invalid JWT' }, status: 400 }, 'auth'],
    ['permission denied (replay by another user)', { error: { code: '42501', message: 'permission denied' }, status: 403 }, 'rejected'],
    ['business rule (outside the window)', { error: { code: 'P0001', message: 'fuera_de_ventana' }, status: 400 }, 'rejected'],
    ['server error', { error: { code: '57014', message: 'timeout' }, status: 500 }, 'rejected'],
  ]
  for (const [name, input, want] of table) assert.equal(classify(input), want, name)
})

test('boot.js finishes a pending purge before the app boots, and does nothing otherwise', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../../public/boot.js', import.meta.url), 'utf8')
  const run = (flag) => {
    const data = new Map(Object.entries({ 'muten:auth:userId': '"u"', 'dd:outbox': '[]', 'sb-x-auth-token': '{}' }))
    const local = { getItem: (k) => data.get(k) ?? null, removeItem: (k) => data.delete(k), setItem: (k, v) => data.set(k, v) }
    Object.defineProperty(local, 'keys', { value: () => [...data.keys()] })
    const session = new Map(flag ? [['dd_purge', '1']] : [])
    const store = { getItem: (k) => session.get(k) ?? null, removeItem: (k) => session.delete(k) }
    const win = { addEventListener() {} }
    new Function('window', 'navigator', 'localStorage', 'sessionStorage', 'Object', `${src.replace(/Object\.keys\(localStorage\)/, 'localStorage.keys()')}`)(win, {}, local, store, Object)
    return { left: [...data.keys()], flag: session.has('dd_purge') }
  }
  assert.deepEqual(run(true), { left: ['sb-x-auth-token'], flag: false })
  assert.deepEqual(run(false), { left: ['muten:auth:userId', 'dd:outbox', 'sb-x-auth-token'], flag: false })
})

// F5b: pageAll reads a PostgREST list past the 1000-row cap, page by page, and never returns a partial list.
test('pageAll walks .range() pages until a short page, and stops at the first error', async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => i)
  const calls = []
  const build = () => ({ range: (a, b) => { calls.push([a, b]); return Promise.resolve({ data: rows.slice(a, b + 1), error: null }) } })
  assert.deepEqual(await pageAll(build), { data: rows, error: null })
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]])
  calls.length = 0
  const exact = () => ({ range: (a, b) => { calls.push([a, b]); return Promise.resolve({ data: rows.slice(0, 1000).slice(a, b + 1), error: null }) } })
  assert.equal((await pageAll(exact)).data.length, 1000)
  assert.deepEqual(calls, [[0, 999], [1000, 1999]], 'a full last page needs one more (empty) page')
  let n = 0
  const flaky = () => ({ range: (a, b) => Promise.resolve(n++ ? { data: null, error: { message: 'down' } } : { data: rows.slice(a, b + 1), error: null }) })
  assert.deepEqual(await pageAll(flaky), { data: null, error: { message: 'down' } }, 'an error is not a short list')
  assert.deepEqual(await pageAll(() => ({ range: () => Promise.resolve({ data: [], error: null }) })), { data: [], error: null })
})
