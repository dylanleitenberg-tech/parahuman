/* parahuman vault: password -> key (PBKDF2-SHA256, 600k) -> AES-256-GCM files.
   File layout (build_vault.py): "PHV1" + salt(16) + iv(12) + ciphertext+tag, gzip inside.
   The derived key is kept in sessionStorage for this tab only, so the 3D page
   opened from the locked section does not ask again. */
(function (global) {
  'use strict';
  const ITER = 600000;
  const KEY = 'phv-key';
  const b64 = (u8) => btoa(String.fromCharCode.apply(null, u8));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  function store(get, set) {
    try { return set === undefined ? sessionStorage.getItem(get) : sessionStorage.setItem(get, set); }
    catch (_) { return null; }
  }

  async function fetchBytes(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error('could not load ' + url + ' (' + r.status + ')');
    return new Uint8Array(await r.arrayBuffer());
  }

  function parts(buf) {
    const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
    if (magic !== 'PHV1') throw new Error('not a vault file');
    return { salt: buf.slice(4, 20), iv: buf.slice(20, 32), ct: buf.slice(32) };
  }

  async function derive(password, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password),
      'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  }

  async function gunzip(u8) {
    const ds = new DecompressionStream('gzip');
    const out = new Response(new Blob([u8]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  }

  let key = null, keySalt = null;

  async function savedKey() {
    const s = store(KEY);
    if (!s) return null;
    try {
      const { k, salt } = JSON.parse(s);
      keySalt = salt;
      return crypto.subtle.importKey('raw', unb64(k), 'AES-GCM', true, ['decrypt']);
    } catch (_) { return null; }
  }

  /* Decrypt one vault file. With a password: derive, and remember the key on
     success. Without: use the remembered key. Throws 'wrong password' on a bad tag. */
  async function open(url, password) {
    const buf = await fetchBytes(url);
    const { salt, iv, ct } = parts(buf);
    const saltB64 = b64(salt);
    let k = null;
    if (password != null) k = await derive(password, salt);
    else {
      if (!key) key = await savedKey();
      if (key && keySalt === saltB64) k = key;
    }
    if (!k) throw new Error('locked');
    let plain;
    try { plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k, ct)); }
    catch (_) { throw new Error('wrong password'); }
    if (password != null) {
      key = k; keySalt = saltB64;
      const raw = new Uint8Array(await crypto.subtle.exportKey('raw', k));
      store(KEY, JSON.stringify({ k: b64(raw), salt: saltB64 }));
    }
    return gunzip(plain);
  }

  function forget() { key = null; keySalt = null; try { sessionStorage.removeItem(KEY); } catch (_) {} }

  /* The astroworm package: JSON head + int16 vertices + uint32 indices per mesh. */
  let pkgP = null, blob = null, index = null;
  function loadPackage(url, password) {
    pkgP = (async () => {
      const u8 = await open(url, password);
      const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      const n = dv.getUint32(0, true);
      const pkg = JSON.parse(new TextDecoder().decode(u8.subarray(4, 4 + n)));
      blob = u8.buffer.slice(u8.byteOffset + 4 + n, u8.byteOffset + u8.byteLength);
      index = pkg.meshes; delete pkg.meshes;
      return pkg;
    })();
    return pkgP;
  }

  function positions(rel) {
    const m = index && (index[rel] || index['meshes/' + rel]);
    if (!m) return null;
    const v = new Int16Array(blob, m.v[0], m.v[1] * 3);
    const ix = new Uint32Array(blob, m.i[0], m.i[1]);
    const out = new Float32Array(ix.length * 3);
    const lo = m.lo, sp = m.span;
    for (let i = 0; i < ix.length; i++) {
      const j = ix[i] * 3, o = i * 3;
      out[o] = lo[0] + (v[j] + 32768) / 65535 * sp[0];
      out[o + 1] = lo[1] + (v[j + 1] + 32768) / 65535 * sp[1];
      out[o + 2] = lo[2] + (v[j + 2] + 32768) / 65535 * sp[2];
    }
    return out;
  }

  global.VAULT = {
    open, forget, loadPackage, positions,
    pkg: () => pkgP || Promise.reject(new Error('package not loaded')),
    hasKey: () => !!store(KEY),
  };
})(window);
