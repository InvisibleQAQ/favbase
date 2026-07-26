/**
 * AES-GCM obfuscation for the WebDAV password at rest (`local:webdav-config`).
 *
 * SCOPE: this is obfuscation, NOT security. The key is derived from a constant
 * baked into the bundle, so anyone with the code can decrypt. Its only job is to
 * keep the password out of plaintext in a casual `chrome.storage` snapshot /
 * exported profile — mirroring ham_home. The config we sync to WebDAV
 * (config.json) still contains plaintext API keys; real E2E encryption is a
 * later phase. Web Crypto is available in both the SW and the extension page.
 */

const KEY_MATERIAL = 'favbase-webdav-obfuscation-v1';

let keyPromise: Promise<CryptoKey> | null = null;

function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(KEY_MATERIAL))
      .then((raw) =>
        crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']),
      );
  }
  return keyPromise;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encrypt a secret → base64(iv ‖ ciphertext). Empty in → empty out. */
export async function encryptSecret(plain: string): Promise<string> {
  if (!plain) return '';
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plain),
  );
  const buf = new Uint8Array(iv.length + ct.byteLength);
  buf.set(iv, 0);
  buf.set(new Uint8Array(ct), iv.length);
  return toBase64(buf);
}

/**
 * Decrypt a base64(iv ‖ ciphertext) blob. On any failure (corruption, or a
 * legacy plaintext value written before obfuscation existed) the input is
 * returned as-is — never throws.
 */
export async function decryptSecret(enc: string): Promise<string> {
  if (!enc) return '';
  try {
    const buf = fromBase64(enc);
    const iv = buf.slice(0, 12);
    const ct = buf.slice(12);
    const key = await getKey();
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return enc;
  }
}
