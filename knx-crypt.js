/* ============================================================
   KNX-Struktur — Entschlüsseln passwortgeschützter ETS-Projekte
   ============================================================ *
 * Mit Projektpasswort legt die ETS das Projekt (P-xxxx/) als inneres,
 * verschlüsseltes ZIP ab. Zwei Verfahren kommen vor:
 *   ETS 5: ZipCrypto (PKWARE), Passwort ist das Projektpasswort selbst.
 *   ETS 6: WinZip-AES-256. Das ZIP-Passwort leitet die ETS ab:
 *          base64(PBKDF2-HMAC-SHA256(Passwort als UTF-16LE,
 *                 "21.project.ets.knx.org", 65536 Runden, 32 Byte)).
 * PBKDF2 und HMAC übernimmt WebCrypto. AES selbst steht hier: WinZip zählt
 * im CTR-Modus little-endian, WebCrypto nur big-endian — damit lässt sich
 * der Schlüsselstrom nicht über WebCrypto erzeugen. Gebraucht wird nur die
 * Verschlüsselungsrichtung eines Blocks (FIPS 197).
 * Das Passwort bleibt im Speicher dieses Aufrufs und wird nirgends abgelegt. */
'use strict';

const KNXCrypt = (() => {

/* ---------- AES (nur Verschlüsseln) ---------- */
const SBOX = new Uint8Array(256);
const T0 = new Uint32Array(256), T1 = new Uint32Array(256), T2 = new Uint32Array(256), T3 = new Uint32Array(256);
(function init() {
  // S-Box über das multiplikative Inverse in GF(2^8) mit affiner Abbildung
  const rotl8 = (x, n) => ((x << n) | (x >>> (8 - n))) & 0xFF;
  let p = 1, q = 1;
  do {
    p = p ^ ((p << 1) & 0xFF) ^ (p & 0x80 ? 0x1B : 0);
    q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xFF;
    if (q & 0x80) q ^= 0x09;
    SBOX[p] = (q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4) ^ 0x63) & 0xFF;
  } while (p !== 1);
  SBOX[0] = 0x63;
  for (let i = 0; i < 256; i++) {
    const s = SBOX[i];
    const s2 = ((s << 1) ^ (s & 0x80 ? 0x1B : 0)) & 0xFF, s3 = s2 ^ s;
    const t = ((s2 << 24) | (s << 16) | (s << 8) | s3) >>> 0;
    T0[i] = t;
    T1[i] = ((t >>> 8) | (t << 24)) >>> 0;
    T2[i] = ((t >>> 16) | (t << 16)) >>> 0;
    T3[i] = ((t >>> 24) | (t << 8)) >>> 0;
  }
})();

const subWord = w => ((SBOX[w >>> 24] << 24) | (SBOX[(w >>> 16) & 0xFF] << 16) |
                      (SBOX[(w >>> 8) & 0xFF] << 8) | SBOX[w & 0xFF]) >>> 0;

/* Rundenschlüssel für 128, 192 oder 256 Bit. */
function expandKey(key) {
  const nk = key.length / 4, nr = nk + 6, w = new Uint32Array(4 * (nr + 1));
  for (let i = 0; i < nk; i++)
    w[i] = ((key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3]) >>> 0;
  let rcon = 1;
  for (let i = nk; i < w.length; i++) {
    let t = w[i - 1];
    if (i % nk === 0) {
      t = (subWord(((t << 8) | (t >>> 24)) >>> 0) ^ (rcon << 24)) >>> 0;
      rcon = ((rcon << 1) ^ (rcon & 0x80 ? 0x1B : 0)) & 0xFF;
    } else if (nk > 6 && i % nk === 4) {
      t = subWord(t);
    }
    w[i] = (w[i - nk] ^ t) >>> 0;
  }
  return { w, nr };
}

/* Verschlüsselt einen 16-Byte-Block `inp` nach `out` (ab `o`). */
function encryptBlock(ks, inp, out, o) {
  const { w, nr } = ks;
  let s0 = ((inp[0] << 24) | (inp[1] << 16) | (inp[2] << 8) | inp[3]) ^ w[0];
  let s1 = ((inp[4] << 24) | (inp[5] << 16) | (inp[6] << 8) | inp[7]) ^ w[1];
  let s2 = ((inp[8] << 24) | (inp[9] << 16) | (inp[10] << 8) | inp[11]) ^ w[2];
  let s3 = ((inp[12] << 24) | (inp[13] << 16) | (inp[14] << 8) | inp[15]) ^ w[3];
  let k = 4;
  for (let r = 1; r < nr; r++) {
    const t0 = T0[s0 >>> 24] ^ T1[(s1 >>> 16) & 0xFF] ^ T2[(s2 >>> 8) & 0xFF] ^ T3[s3 & 0xFF] ^ w[k++];
    const t1 = T0[s1 >>> 24] ^ T1[(s2 >>> 16) & 0xFF] ^ T2[(s3 >>> 8) & 0xFF] ^ T3[s0 & 0xFF] ^ w[k++];
    const t2 = T0[s2 >>> 24] ^ T1[(s3 >>> 16) & 0xFF] ^ T2[(s0 >>> 8) & 0xFF] ^ T3[s1 & 0xFF] ^ w[k++];
    const t3 = T0[s3 >>> 24] ^ T1[(s0 >>> 16) & 0xFF] ^ T2[(s1 >>> 8) & 0xFF] ^ T3[s2 & 0xFF] ^ w[k++];
    s0 = t0; s1 = t1; s2 = t2; s3 = t3;
  }
  const last = (a, b, c, d, key) => ((SBOX[a >>> 24] << 24) | (SBOX[(b >>> 16) & 0xFF] << 16) |
                                     (SBOX[(c >>> 8) & 0xFF] << 8) | SBOX[d & 0xFF]) ^ key;
  const r0 = last(s0, s1, s2, s3, w[k]), r1 = last(s1, s2, s3, s0, w[k + 1]);
  const r2 = last(s2, s3, s0, s1, w[k + 2]), r3 = last(s3, s0, s1, s2, w[k + 3]);
  [r0, r1, r2, r3].forEach((v, i) => {
    out[o + 4 * i] = v >>> 24; out[o + 4 * i + 1] = (v >>> 16) & 0xFF;
    out[o + 4 * i + 2] = (v >>> 8) & 0xFF; out[o + 4 * i + 3] = v & 0xFF;
  });
}

/* CTR nach WinZip: Zähler beginnt bei 1 und steht little-endian im Block. */
function ctrLE(key, data) {
  const ks = expandKey(key);
  const out = new Uint8Array(data.length);
  const ctr = new Uint8Array(16), stream = new Uint8Array(16);
  for (let at = 0, n = 1; at < data.length; at += 16, n++) {
    for (let i = 0, v = n; i < 16; i++) { ctr[i] = v & 0xFF; v = Math.floor(v / 256); }
    encryptBlock(ks, ctr, stream, 0);
    const end = Math.min(16, data.length - at);
    for (let i = 0; i < end; i++) out[at + i] = data[at + i] ^ stream[i];
  }
  return out;
}

/* ---------- WebCrypto-Helfer ---------- */
const subtle = () => {
  if (!(globalThis.crypto && crypto.subtle))
    throw new Error('Dieser Browser bietet keine Kryptografie-Schnittstelle (nur über https oder localhost).');
  return crypto.subtle;
};
async function pbkdf2(hash, pw, salt, rounds, bytes) {
  const key = await subtle().importKey('raw', pw, 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', hash, salt, iterations: rounds }, key, bytes * 8));
}
async function hmacSha1(key, data) {
  const k = await subtle().importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  return new Uint8Array(await subtle().sign('HMAC', k, data));
}

/* ---------- Passwörter ---------- */
const utf16le = s => {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) { out[2 * i] = s.charCodeAt(i) & 0xFF; out[2 * i + 1] = s.charCodeAt(i) >>> 8; }
  return out;
};
const latin1 = s => Uint8Array.from(s, c => c.charCodeAt(0) & 0xFF);

/* Das ZIP-Passwort der ETS 6 aus dem Projektpasswort. */
async function ets6Password(pw) {
  const raw = await pbkdf2('SHA-256', utf16le(pw), new TextEncoder().encode('21.project.ets.knx.org'), 65536, 32);
  return new TextEncoder().encode(btoa(String.fromCharCode(...raw)));
}

/* ---------- WinZip-AES ---------- */
const SALT = { 1: 8, 2: 12, 3: 16 };
const KEYLEN = { 1: 16, 2: 24, 3: 32 };

async function aesKeys(pw, e, data) {
  const sl = SALT[e.aes.strength], kl = KEYLEN[e.aes.strength];
  if (!sl) throw new Error(`Eintrag „${e.name}“: unbekannte AES-Schlüssellänge.`);
  if (data.length < sl + 2 + 10) throw new Error(`Eintrag „${e.name}“ ist zu kurz.`);
  const d = await pbkdf2('SHA-1', pw, data.subarray(0, sl), 1000, 2 * kl + 2);
  const ok = d[2 * kl] === data[sl] && d[2 * kl + 1] === data[sl + 1];
  return ok ? { enc: d.subarray(0, kl), mac: d.subarray(kl, 2 * kl) } : null;
}

async function aesDecrypt(keys, e, data) {
  const sl = SALT[e.aes.strength];
  const body = data.subarray(sl + 2, data.length - 10);
  const mac = (await hmacSha1(keys.mac, body)).subarray(0, 10);
  const want = data.subarray(data.length - 10);
  if (mac.some((b, i) => b !== want[i]))
    throw new Error(`Eintrag „${e.name}“ ist beschädigt (Prüfsumme der Verschlüsselung stimmt nicht).`);
  return ctrLE(keys.enc, body);
}

/* ---------- ZipCrypto ---------- */
function zipCrypto(pw, e, data) {
  const T = KNXProd.zip.CRC_TABLE;
  const crcByte = (c, b) => T[(c ^ b) & 0xFF] ^ (c >>> 8);
  let k0 = 305419896, k1 = 591751049, k2 = 878082192;
  const update = b => {
    k0 = crcByte(k0, b);
    k1 = (Math.imul(((k1 + (k0 & 0xFF)) >>> 0), 134775813) + 1) >>> 0;
    k2 = crcByte(k2, k1 >>> 24);
  };
  pw.forEach(update);
  if (data.length < 12) return null;
  const out = new Uint8Array(data.length - 12);
  let check = 0;
  for (let i = 0; i < data.length; i++) {
    const t = (k2 | 2) & 0xFFFF;
    const b = data[i] ^ ((Math.imul(t, t ^ 1) >>> 8) & 0xFF);
    update(b);
    if (i < 12) { if (i === 11) check = b; } else out[i - 12] = b;
  }
  // Das letzte Kopfbyte nennt das obere Byte der CRC oder, mit Datenbeschreiber, der Uhrzeit
  const want = (e.flags & 0x08) ? (e.time >>> 8) & 0xFF : e.crc >>> 24;
  return check === want ? out : null;
}

/**
 * Liefert eine Entschlüsselungsfunktion für KNXProd.zip.read. Welche Form
 * des Passworts passt (ETS-6-Ableitung, UTF-8, Latin-1), zeigt der erste
 * Eintrag; danach bleibt es dabei. Falsch → Fehler mit `wrongPassword`.
 */
function decryptor(password) {
  let cands = null, chosen = null;
  const candidates = async () => {
    if (!cands) cands = [await ets6Password(password), new TextEncoder().encode(password), latin1(password)];
    return cands;
  };
  const wrong = () => {
    const err = new Error('Das Passwort ist falsch.');
    err.wrongPassword = true;
    return err;
  };
  return async (e, data) => {
    const list = chosen ? [chosen] : await candidates();
    for (const pw of list) {
      if (e.aes) {
        const keys = await aesKeys(pw, e, data);
        if (!keys) continue;
        chosen = pw;
        return aesDecrypt(keys, e, data);
      }
      const out = zipCrypto(pw, e, data);
      if (out) { chosen = pw; return out; }
    }
    throw wrong();
  };
}

return { decryptor, ets6Password, _test: { encryptBlock, expandKey, ctrLE } };
})();
