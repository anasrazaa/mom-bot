const BASE = '';  // nginx proxies /meeting, /transcript, etc. to backend

async function _fetch(method, path, body) {
  const opts = {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  };
  const r = await fetch(BASE + path, opts);
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: r.statusText }));
    throw new Error(e.detail || r.statusText);
  }
  return r.json();
}

async function _form(path, formData) {
  const r = await fetch(BASE + path, { method: 'POST', body: formData });
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: r.statusText }));
    throw new Error(e.detail || r.statusText);
  }
  return r.json();
}

export const api = {
  get:    (p)    => _fetch('GET',    p),
  post:   (p, b) => _fetch('POST',   p, b),
  patch:  (p, b) => _fetch('PATCH',  p, b),
  delete: (p)    => _fetch('DELETE', p),
  form:   (p, f) => _form(p, f),
};

export function wsUrl(path) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}${path}`;
}
