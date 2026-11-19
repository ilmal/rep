// Generate a VAPID key pair (P-256) for Web Push, offline, no dependencies:  bun deploy/gen-vapid.ts
// Prints shell-ready KEY=VALUE lines (public + private are base64url, the format web-push libraries expect).
// NOTE: the server's /api/push extension (src/server/ext/push.ts) is currently an EMPTY STUB and reads no VAPID_*
// variables, so these are only needed once push is implemented. Keep the private key secret.
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const b64u = (b: ArrayBuffer | Uint8Array) => Buffer.from(b as ArrayBuffer).toString('base64url');
const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));             // 65-byte uncompressed point
const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);                  // d = 32-byte private scalar
console.log(`VAPID_PUBLIC_KEY=${pub}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
console.log(`VAPID_SUBJECT=mailto:you@example.com   # owner decision: a mailbox you read`);
