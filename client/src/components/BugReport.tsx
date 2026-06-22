import { useEffect, useRef, useState } from 'react';

const SEVERITIES = [
  { value: 'low', label: 'Minor — cosmetic' },
  { value: 'med', label: 'Medium — disruptive' },
  { value: 'high', label: 'High — hard to play' },
  { value: 'urgent', label: 'Urgent — game-breaking' },
];

type Status = 'idle' | 'sending' | 'sent' | 'error';

export default function BugReport() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState('med');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    const id = window.setTimeout(() => ref.current?.focus(), 40);
    return () => { document.removeEventListener('keydown', onKey); window.clearTimeout(id); };
  }, [open]);

  function close() {
    setOpen(false);
    window.setTimeout(() => { setMessage(''); setSeverity('med'); setStatus('idle'); setError(''); }, 200);
  }

  async function send() {
    const trimmed = message.trim();
    if (!trimmed) { setError('A few words first, please.'); ref.current?.focus(); return; }
    setStatus('sending'); setError('');
    try {
      const res = await fetch('/api/bug-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          severity,
          url: window.location.href,
          meta: { path: window.location.pathname, viewport: `${window.innerWidth}x${window.innerHeight}`, userAgent: navigator.userAgent },
        }),
      });
      if (!res.ok) throw new Error();
      setStatus('sent');
      window.setTimeout(close, 1300);
    } catch {
      setStatus('error'); setError('Could not send. Try again.');
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Report a fault"
        className="fixed bottom-5 right-5 z-40 font-display text-xs font-bold uppercase tracking-[0.2em]
                   border border-blood-700 bg-midnight-900 px-4 py-3 text-parchment-100 shadow-dramatic
                   transition hover:-translate-y-0.5 hover:border-blood-500 hover:text-blood-400
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-blood-600"
      >
        Report a fault
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 font-body"
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <div role="dialog" aria-modal="true" aria-label="Report a fault"
               className="w-full max-w-md border border-blood-800 bg-midnight-950 p-7 shadow-dramatic">
            <h2 className="font-display text-2xl font-black tracking-wide text-parchment-100">Found a fault?</h2>
            <p className="mt-1 text-sm text-parchment-200/70">
              Tell us what went wrong — it is filed straight to the record.
            </p>

            {status === 'sent' ? (
              <div className="mt-6 border border-blood-800 bg-blood-950/40 px-4 py-6 text-center text-sm text-parchment-100">
                Your report has been filed. With thanks.
              </div>
            ) : (
              <>
                <label htmlFor="sh-bug-msg" className="mt-6 block font-display text-[11px] font-bold uppercase tracking-[0.18em] text-gold-400">
                  What went wrong?
                </label>
                <textarea id="sh-bug-msg" ref={ref} value={message} onChange={(e) => setMessage(e.target.value)}
                  rows={4} maxLength={5000} placeholder="What you saw, and what you expected…"
                  className="mt-2 w-full resize-y border border-midnight-700 bg-midnight-900 p-3 text-sm text-parchment-100
                             placeholder-midnight-400 focus:border-blood-600 focus:outline-none" />

                <label htmlFor="sh-bug-sev" className="mt-4 block font-display text-[11px] font-bold uppercase tracking-[0.18em] text-gold-400">
                  How grave?
                </label>
                <select id="sh-bug-sev" value={severity} onChange={(e) => setSeverity(e.target.value)}
                  className="mt-2 w-full border border-midnight-700 bg-midnight-900 p-2.5 text-sm text-parchment-100 focus:border-blood-600 focus:outline-none">
                  {SEVERITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>

                <div className="mt-6 flex items-center gap-4">
                  <span className="mr-auto text-xs text-blood-400">{error}</span>
                  <button type="button" onClick={close} className="font-display text-xs font-bold uppercase tracking-[0.18em] text-parchment-200/50 hover:text-parchment-100">Cancel</button>
                  <button type="button" onClick={send} disabled={status === 'sending'}
                    className="border border-blood-600 bg-blood-800 px-5 py-2.5 font-display text-xs font-bold uppercase tracking-[0.18em] text-parchment-100 hover:bg-blood-700 disabled:opacity-60">
                    {status === 'sending' ? 'Filing…' : 'File report'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
