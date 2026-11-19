// Transactional mail for the magic-link sign-in. Providers, first configured wins:
//   1. Amazon SES v2 (SigV4 over fetch + WebCrypto, no SDK):  SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY, [SES_REGION=eu-north-1]
//   2. Resend:                                                  RESEND_API_KEY
// Sender: MAIL_FROM (default "Rep <rep@ilmal.se>"). The sending domain must be a verified SES identity.
import { createHash, createHmac } from 'node:crypto';

export interface MailEnv { [k: string]: string | undefined }
export interface Mail { to: string; subject: string; text: string; html: string }
export interface Mailer { provider: 'ses' | 'resend' | null; send(m: Mail): Promise<boolean> }

export const DEFAULT_FROM = 'Rep <rep@ilmal.se>';

const hex = (b: Buffer | Uint8Array) => Buffer.from(b).toString('hex');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const hmac = (key: Buffer | string, s: string) => createHmac('sha256', key).update(s).digest();

/** AWS Signature V4 for a JSON POST. Pure: exported for tests against fixed vectors. */
export function signV4(o: { method: string; host: string; path: string; body: string; region: string; service: string; accessKey: string; secretKey: string; amzDate: string; sessionToken?: string }): Record<string, string> {
  const date = o.amzDate.slice(0, 8);
  const headers: Record<string, string> = { 'content-type': 'application/json', host: o.host, 'x-amz-date': o.amzDate };
  if (o.sessionToken) headers['x-amz-security-token'] = o.sessionToken;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]!.trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonical = [o.method, o.path, '', canonicalHeaders, signedHeaders, sha256(o.body)].join('\n');
  const scope = `${date}/${o.region}/${o.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', o.amzDate, scope, sha256(canonical)].join('\n');
  const kDate = hmac(`AWS4${o.secretKey}`, date);
  const kSigning = hmac(hmac(hmac(kDate, o.region), o.service), 'aws4_request');
  const signature = hex(hmac(kSigning, toSign));
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${o.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}

export const amzDateOf = (ms: number) => new Date(ms).toISOString().replace(/[:-]|\.\d{3}/g, '');

export function createMailer(env: MailEnv = process.env, f: typeof fetch = fetch, now: () => number = Date.now): Mailer {
  const from = env.MAIL_FROM || DEFAULT_FROM;
  const ak = env.SES_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID;
  const sk = env.SES_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY;
  if (ak && sk) {
    const region = env.SES_REGION || env.AWS_REGION || 'eu-north-1';
    const host = `email.${region}.amazonaws.com`;
    return {
      provider: 'ses',
      async send(m) {
        const body = JSON.stringify({
          FromEmailAddress: from,
          Destination: { ToAddresses: [m.to] },
          Content: { Simple: { Subject: { Data: m.subject, Charset: 'UTF-8' }, Body: { Text: { Data: m.text, Charset: 'UTF-8' }, Html: { Data: m.html, Charset: 'UTF-8' } } } },
        });
        const headers = signV4({ method: 'POST', host, path: '/v2/email/outbound-emails', body, region, service: 'ses', accessKey: ak, secretKey: sk, amzDate: amzDateOf(now()), sessionToken: env.SES_SESSION_TOKEN });
        const res = await f(`https://${host}/v2/email/outbound-emails`, { method: 'POST', headers, body }).catch(() => null);
        if (res && !res.ok) console.error(`[mail] SES ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
        return !!res && res.ok;
      },
    };
  }
  if (env.RESEND_API_KEY) {
    return {
      provider: 'resend',
      async send(m) {
        const res = await f('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
        }).catch(() => null);
        return !!res && res.ok;
      },
    };
  }
  return { provider: null, send: async () => false };
}
