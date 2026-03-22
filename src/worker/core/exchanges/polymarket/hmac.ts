/** Standalone HMAC-SHA256 signing for Polymarket CLOB API authentication. */

export interface HmacSignatureParams {
  /** Base64-encoded API secret (as issued by Polymarket). */
  secret: string;
  /** Unix timestamp in seconds as string. */
  timestamp: string;
  /** HTTP method in uppercase (e.g., "GET", "POST"). */
  method: string;
  /** Request path including leading slash (e.g., "/markets"). */
  path: string;
  /** Request body string, or empty string for requests with no body. */
  body: string;
}

/**
 * Build a Polymarket CLOB HMAC-SHA256 signature.
 *
 * Matches the official Polymarket clob-client SDK signing pattern:
 * - Secret is base64-decoded before use as HMAC key material
 * - Output is URL-safe base64 (replaces + with - and / with _)
 *
 * Message format: `${timestamp}${method}${path}${body}`
 *
 * @param params - Signing parameters including secret, timestamp, method, path, body
 * @returns URL-safe base64 encoded HMAC-SHA256 signature string
 */
export async function buildHmacSignature(
  params: HmacSignatureParams
): Promise<string> {
  // 1. Normalize the secret: handle both standard and URL-safe base64 variants
  const normalized = params.secret.replace(/-/g, "+").replace(/_/g, "/");

  // 2. Decode base64 secret to raw key bytes (not UTF-8 encoded)
  const secretBytes = Uint8Array.from(atob(normalized), (c) =>
    c.charCodeAt(0)
  );

  // 3. Import key material for HMAC-SHA256
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  // 4. Build message: timestamp + method + path + body
  const message = `${params.timestamp}${params.method}${params.path}${params.body}`;

  // 5. Sign
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );

  // 6. Encode as URL-safe base64 (replace + with - and / with _)
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
