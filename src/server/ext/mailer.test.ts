import { describe, expect, test } from 'bun:test';
import { amzDateOf, createMailer, DEFAULT_FROM, signV4 } from './mailer';

const mail = { to: 'a@b.se', subject: 'Hi', text: 't', html: '<p>h</p>' };

describe('signV4', () => {
  test('matches an independent implementation (fixed vector)', () => {
    const h = signV4({ method: 'POST', host: 'email.eu-north-1.amazonaws.com', path: '/v2/email/outbound-emails', body: '{"a":1}', region: 'eu-north-1', service: 'ses', accessKey: 'AKID', secretKey: 'SECRETKEY', amzDate: '20261118T120000Z' });
    expect(h.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKID/20261118/eu-north-1/ses/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=72f1ddae7374a9537eb3ccd5397079d13c56478e99aaf820875e769f99d85f06');
    expect(h['x-amz-date']).toBe('20261118T120000Z');
  });
  test('session token is signed too', () => {
    const h = signV4({ method: 'POST', host: 'h', path: '/p', body: '', region: 'r', service: 's', accessKey: 'a', secretKey: 'k', amzDate: '20261118T120000Z', sessionToken: 'tok' });
    expect(h['x-amz-security-token']).toBe('tok');
    expect(h.authorization).toContain('SignedHeaders=content-type;host;x-amz-date;x-amz-security-token');
  });
  test('amzDateOf formats basic ISO', () => expect(amzDateOf(Date.UTC(2026, 10, 18, 12, 0, 0, 123))).toBe('20261118T120000Z'));
});

describe('createMailer', () => {
  test('no config → provider null, send false', async () => {
    const m = createMailer({}, (() => { throw new Error('no network'); }) as unknown as typeof fetch);
    expect(m.provider).toBeNull();
    expect(await m.send(mail)).toBe(false);
  });
  test('SES: signed v2 request to the regional endpoint, default sender gym@ilmal.se', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    const m = createMailer({ SES_ACCESS_KEY_ID: 'AK', SES_SECRET_ACCESS_KEY: 'SK' }, f, () => Date.UTC(2026, 10, 18, 12));
    expect(m.provider).toBe('ses');
    expect(await m.send(mail)).toBe(true);
    expect(seen!.url).toBe('https://email.eu-north-1.amazonaws.com/v2/email/outbound-emails');
    const b = JSON.parse(String(seen!.init.body));
    expect(b.FromEmailAddress).toBe(DEFAULT_FROM);
    expect(b.Destination.ToAddresses).toEqual(['a@b.se']);
    expect(b.Content.Simple.Subject.Data).toBe('Hi');
    expect(b.Content.Simple.Body.Html.Data).toBe('<p>h</p>');
    expect((seen!.init.headers as Record<string, string>).authorization).toStartWith('AWS4-HMAC-SHA256 Credential=AK/20261118/eu-north-1/ses/aws4_request');
  });
  test('SES wins over Resend; custom region/from honoured; failure → false', async () => {
    let url = ''; let body = '';
    const f = (async (u: string, init: RequestInit) => { url = u; body = String(init.body); return new Response('nope', { status: 400 }); }) as unknown as typeof fetch;
    const m = createMailer({ SES_ACCESS_KEY_ID: 'AK', SES_SECRET_ACCESS_KEY: 'SK', RESEND_API_KEY: 'x', SES_REGION: 'eu-west-1', MAIL_FROM: 'X <x@ilmal.se>' }, f);
    expect(await m.send(mail)).toBe(false);
    expect(url).toContain('email.eu-west-1.amazonaws.com');
    expect(JSON.parse(body).FromEmailAddress).toBe('X <x@ilmal.se>');
  });
  test('network error → false', async () => {
    const m = createMailer({ SES_ACCESS_KEY_ID: 'AK', SES_SECRET_ACCESS_KEY: 'SK' }, (async () => { throw new Error('down'); }) as unknown as typeof fetch);
    expect(await m.send(mail)).toBe(false);
  });
  test('Resend fallback', async () => {
    let url = '';
    const f = (async (u: string) => { url = u; return new Response('{}'); }) as unknown as typeof fetch;
    const m = createMailer({ RESEND_API_KEY: 're' }, f);
    expect(m.provider).toBe('resend');
    expect(await m.send(mail)).toBe(true);
    expect(url).toBe('https://api.resend.com/emails');
  });
});
