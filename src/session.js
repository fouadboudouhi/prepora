// The Volumora account also opens Prepora: same server, same name and password, and through it the same Claude key.
// The key stays on the server. Prepora only asks who is signed in and talks to Claude; it never touches /v1/snapshot,
// which holds the person's Volumora data.
const KEY = 'prepora-session';
const SIGNED_OUT = 'prepora-signed-out';
// Volumora shares this domain, so a browser signed in there can use that sign-in here. An app installed on an iPhone
// has its own storage and asks once.
const VOLUMORA_KEY = 'volumora-sync';
export const SERVER_URL = 'https://raspberrypi.tail9d7f95.ts.net';

export class SessionError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const read = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
};
const save = (session) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
    localStorage.removeItem(SIGNED_OUT);
  } catch {
    // Without storage the sign-in lasts until the app closes.
  }
  return session;
};

function fromVolumora() {
  const found = read(VOLUMORA_KEY);
  if (!found?.token || found.url !== SERVER_URL || found.problem === 'session') return null;
  return save({ url: found.url, username: found.username, token: found.token, shared: true });
}

export function getSession() {
  return read(KEY) ?? (localStorage.getItem(SIGNED_OUT) ? null : fromVolumora());
}

const update = (changes) => {
  const session = read(KEY);
  if (session) save({ ...session, ...changes });
};

function forget() {
  try {
    localStorage.removeItem(KEY);
    localStorage.setItem(SIGNED_OUT, '1');
  } catch {
    // Nothing stored, nothing to forget.
  }
}

async function call(path, options = {}, token = getSession()?.token) {
  let response;
  try {
    response = await fetch(`${SERVER_URL}${path}`, {
      ...options,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new SessionError('network');
  }
  if (response.ok) return response;
  throw new SessionError(
    { 401: 'user', 402: 'budget', 429: 'blocked', 503: 'noai' }[response.status] ?? 'server'
  );
}

export async function signIn(username, password) {
  const response = await call(
    '/v1/login',
    { method: 'POST', body: JSON.stringify({ username, password }) },
    ''
  );
  const { token } = await response.json().catch(() => ({}));
  if (typeof token !== 'string' || !token.includes('.')) throw new SessionError('server');
  return save({ url: SERVER_URL, username: username.trim().toLowerCase(), token });
}

export async function signOut() {
  const session = getSession();
  forget();
  // A sign-in borrowed from Volumora stays valid there.
  if (session?.token && !session.shared)
    await call('/v1/logout', { method: 'POST' }, session.token).catch(() => {});
}

// Who the server says we are, and how much Claude is left this month. A sign-in the server no longer knows ends here.
export async function refreshMe() {
  const session = getSession();
  if (!session) return null;
  try {
    const response = await call('/v1/me', {}, session.token);
    const me = await response.json();
    update({ ai: me.ai ?? null });
    return me;
  } catch (err) {
    if (err.code === 'user') forget();
    throw err;
  }
}

export const aiCall = (body, headers) =>
  call('/v1/ai/messages', { method: 'POST', body: JSON.stringify(body), headers });
