/**
 * Authenticated encryption for secrets at rest (eBay refresh/access tokens).
 *
 * AES-256-GCM via Web Crypto (works on Node and Workers). A fresh 96-bit IV per
 * message; GCM's auth tag makes any tampering fail decryption. Format:
 *   v1.<iv base64url>.<ciphertext+tag base64url>
 * The version prefix allows key/algorithm rotation later.
 */

const VERSION = "v1";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export class TokenCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenCipherError";
  }
}

export interface TokenCipher {
  encrypt(plaintext: string): Promise<string>;
  decrypt(payload: string): Promise<string>;
}

/** @param base64Key 32 random bytes, standard base64 (TOKEN_ENCRYPTION_KEY). */
export function createTokenCipher(base64Key: string): TokenCipher {
  const raw = fromBase64Url(base64Key.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""));
  if (raw.length !== 32) throw new TokenCipherError("Encryption key must be 32 bytes");
  const keyPromise = crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);

  return {
    async encrypt(plaintext) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        await keyPromise,
        new TextEncoder().encode(plaintext),
      );
      return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
    },

    async decrypt(payload) {
      const [version, ivPart, dataPart, ...rest] = payload.split(".");
      if (version !== VERSION || !ivPart || !dataPart || rest.length > 0) {
        throw new TokenCipherError("Unsupported encrypted payload format");
      }
      try {
        const plaintext = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: fromBase64Url(ivPart) },
          await keyPromise,
          fromBase64Url(dataPart),
        );
        return new TextDecoder().decode(plaintext);
      } catch {
        // Wrong key or tampered data. Never include the payload in the message.
        throw new TokenCipherError("Could not decrypt payload");
      }
    },
  };
}
