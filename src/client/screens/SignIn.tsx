import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useNow } from '../lib/hooks';
import { skipSignInPrompt } from '../lib/signin-skip';
import { useStore } from '../store/core';
import { isEmail, requestLink, verifyLink, type RequestResult, type VerifyResult } from '../store/x-signin';

const RESEND_S = 30;
type Fail = Extract<RequestResult, { ok: false }>['error'];
const MESSAGES: Record<Exclude<Fail, 'invalid_email'>, string> = {
  offline: "You're offline. Connect to the internet to get your sign-in link.",
  rate_limited: 'Too many requests. Wait a minute and try again.',
  email_not_configured: "Sign-in emails aren't available right now. Your data stays safe on this device.",
  send_failed: "We couldn't send the email. Try again in a moment.",
  failed: 'Something went wrong. Try again.',
};
const VERIFY_MESSAGES: Record<string, string> = {
  invalid_or_expired: 'It may have expired or already been used. Links work once and last 15 minutes.',
  offline: "You're offline. Connect to the internet and open the link again.",
  rate_limited: 'Too many attempts. Wait a minute and open the link again.',
  failed: 'Something went wrong on our side. Try opening the link again.',
};

export default function SignIn() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const onboarded = useStore((s) => s.settings.onboarded);
  const signedOut = useStore((s) => !!s.device.wasSignedIn && !s.device.token);
  const home = onboarded ? '/' : '/welcome';
  const linkToken = params.get('token');

  const [email, setEmail] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [devLink, setDevLink] = useState('');
  const now = useNow(250);

  // Magic-link landing: /signin?token=…
  const [verify, setVerify] = useState<'idle' | 'working' | 'ok' | 'fail'>(linkToken ? 'working' : 'idle');
  const [verifyRes, setVerifyRes] = useState<VerifyResult | null>(null);
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (!linkToken || started.current === linkToken) return;
    started.current = linkToken;
    let alive = true;
    setVerify('working');
    void verifyLink(linkToken).then((r) => {
      if (!alive) return;
      setVerifyRes(r);
      setVerify(r.ok ? 'ok' : 'fail');
    });
    return () => { alive = false; started.current = null; };
  }, [linkToken]);
  useEffect(() => {
    if (verify !== 'ok' || !verifyRes?.ok) return;
    const dest = verifyRes.onboarded ? '/' : '/onboarding/goal';
    const t = setTimeout(() => navigate(dest, { replace: true }), 1200);
    return () => clearTimeout(t);
  }, [verify, verifyRes, navigate]);

  const valid = isEmail(email);
  const showErr = tried && !valid;
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));

  async function send(fromResend = false) {
    if (busy) return;
    if (!valid) { setTried(true); return; }
    setTried(true);
    setBusy(true);
    setErr('');
    const r = await requestLink(email);
    setBusy(false);
    if (r.ok) {
      setSent(true);
      setDevLink(r.devLink ? (() => { const u = new URL(r.devLink, location.href); return `${location.origin}${u.pathname}${u.search}`; })() : '');
      setResendAt(Date.now() + RESEND_S * 1000);
      return;
    }
    if (r.error === 'rate_limited' && r.retryAfter) setResendAt(Date.now() + r.retryAfter * 1000);
    if (r.error === 'invalid_email') { setSent(false); return; }
    setErr(MESSAGES[r.error]);
    if (!fromResend) setSent(false);
  }

  function back() {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1); else navigate(onboarded ? '/settings' : '/welcome');
  }

  function restart() {
    setParams({}, { replace: true });
    setVerify('idle');
    setVerifyRes(null);
  }

  const topbar = (
    <div className="topbar">
      <button type="button" className="iconbtn" aria-label="Back" onClick={back}><span className="ic ic-chev-left lg" aria-hidden="true" /></button>
      <span className="title" />
      <Link className="btn btn-ghost btn-sm" to={home} style={{ minHeight: 44 }} onClick={skipSignInPrompt}>{signedOut ? 'Not now' : 'Skip'}</Link>
    </div>
  );
  const outNote = signedOut && !err && <div className="banner warn" role="status" data-testid="signed-out-note"><span className="ic ic-alert" aria-hidden="true" /><div>You've been signed out. Sign in again to keep syncing your sessions. Your data is still on this device.</div></div>;
  const banner = err && <div className="banner warn" role="alert"><span className="ic ic-alert" aria-hidden="true" /><div>{err}</div></div>;

  if (verify !== 'idle') {
    const failed = verify === 'fail' && verifyRes && !verifyRes.ok ? verifyRes.error : 'failed';
    return (
      <div className="app">
        {topbar}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 24px' }} role="status" aria-live="polite">
          <div className="empty" style={{ padding: 0 }}>
            {verify === 'working' && (<>
              <div className="empty-ic blue"><span className="ic ic-link xxl" aria-hidden="true" /></div>
              <h1 className="t-title">Signing you in…</h1>
              <p className="sub" style={{ fontSize: 16 }}>Checking your link and syncing your sessions.</p>
            </>)}
            {verify === 'ok' && verifyRes?.ok && (<>
              <div className="empty-ic warm"><span className="ic ic-check xxl" aria-hidden="true" /></div>
              <h1 className="t-title">You're signed in</h1>
              <p className="sub" style={{ fontSize: 16 }}>Your sessions are saved to <b style={{ color: '#121212' }}>{verifyRes.email}</b>.</p>
            </>)}
            {verify === 'fail' && (<>
              <div className="empty-ic red"><span className="ic ic-alert xxl" aria-hidden="true" /></div>
              <h1 className="t-title">That link didn't work</h1>
              <p className="sub" style={{ fontSize: 16 }}>{VERIFY_MESSAGES[failed]}</p>
            </>)}
          </div>
        </div>
        <div style={{ padding: '0 20px 36px', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 100 }}>
          {verify === 'ok' && <button type="button" className="btn btn-primary" onClick={() => navigate(verifyRes?.ok && verifyRes.onboarded ? '/' : '/onboarding/goal', { replace: true })}>Continue</button>}
          {verify === 'fail' && (<>
            <button type="button" className="btn btn-primary" onClick={restart}>Send a new link</button>
            <Link className="btn btn-ghost" to={home} onClick={skipSignInPrompt}>Not now: keep data on this device</Link>
          </>)}
        </div>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="app">
        {topbar}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 24px' }}>
          <div className="empty" style={{ padding: 0 }}>
            <div className="empty-ic blue"><span className="ic ic-link xxl" aria-hidden="true" /></div>
            <h1 className="t-title">Check your email</h1>
            <p className="sub" style={{ fontSize: 16 }}>We sent a sign-in link to <b style={{ color: '#121212' }}>{email.trim()}</b>. Open it on this phone and you'll come straight back here, signed in.</p>
            {import.meta.env.DEV && devLink && <a data-testid="dev-link" href={devLink} className="help">Dev link</a>}
          </div>
        </div>
        <div style={{ padding: '0 20px 36px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {banner}{outNote}
          <Link className="btn btn-primary" to={home}>I've opened the link</Link>
          <button type="button" className="btn btn-secondary" disabled={wait > 0 || busy} onClick={() => void send(true)}>{busy ? 'Sending…' : wait > 0 ? `Resend in ${wait} s` : 'Resend link'}</button>
          <button type="button" className="btn btn-ghost" onClick={() => { setSent(false); setErr(''); setResendAt(0); }}>Use a different email</button>
        </div>
      </div>
    );
  }

  return (
    <form className="app" noValidate onSubmit={(e) => { e.preventDefault(); void send(); }}>
      {topbar}
      <div className="scroll" style={{ paddingTop: 8, paddingBottom: 140 }}>
        <div className="empty-ic warm" style={{ width: 72, height: 72, alignSelf: 'flex-start' }}><span className="ic ic-cloud xl" aria-hidden="true" /></div>
        <div className="stack-s" style={{ gap: 6 }}>
          <h1 className="t-display">Save your progress</h1>
          <p className="sub" style={{ fontSize: 16 }}>Sign in or create an account with just your email. No password. Your sessions sync across devices and survive a lost phone.</p>
        </div>
        <label className="field">
          <span className="lbl" style={{ paddingLeft: 2 }}>Email</span>
          <input className={`input${showErr ? ' err' : ''}`} type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={showErr} aria-describedby={showErr ? 'email-err' : undefined} />
          {showErr && <span id="email-err" className="help err">That doesn't look like an email address.</span>}
        </label>
        {banner}{outNote}
        <div className="group">
          <div className="li"><span className="tile sm green"><span className="ic ic-shield sm" aria-hidden="true" /></span><div className="grow"><span className="li-t">Backed up</span><span className="li-s">Safe even if your phone clears website data</span></div></div>
          <div className="li"><span className="tile sm blue"><span className="ic ic-repeat sm" aria-hidden="true" /></span><div className="grow"><span className="li-t">Phone and computer</span><span className="li-s">Plan on desktop, train on your phone</span></div></div>
          <div className="li"><span className="tile sm"><span className="ic ic-lock sm" aria-hidden="true" /></span><div className="grow"><span className="li-t">Only for sign-in</span><span className="li-s">No newsletters. Delete your account any time.</span></div></div>
        </div>
      </div>
      <div className="bottombar">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send sign-in link'}</button>
        <Link className="btn btn-ghost" to={home} style={{ minHeight: 40, fontSize: 14 }}>Not now: keep data on this device</Link>
      </div>
    </form>
  );
}
