import { useEffect, useRef, useState } from 'react';

const SEVERITIES = [
  { value: 'low', label: 'Minor — cosmetic' },
  { value: 'med', label: 'Medium — disruptive' },
  { value: 'high', label: 'High — hard to play' },
  { value: 'urgent', label: 'Urgent — game-breaking' },
];

const MAX_SHOTS = 4;
const MAX_SHOT_BYTES = 8 * 1024 * 1024; // 8MB
const SHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

type Status = 'idle' | 'sending' | 'sent' | 'error';
type Shot = { file: File; url: string };

export default function BugReport() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState('med');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [shots, setShots] = useState<Shot[]>([]);
  const [dragging, setDragging] = useState(false);
  const [shotWarning, setShotWarning] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const shotsRef = useRef<Shot[]>([]);
  shotsRef.current = shots;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    const id = window.setTimeout(() => ref.current?.focus(), 40);
    return () => { document.removeEventListener('keydown', onKey); window.clearTimeout(id); };
  }, [open]);

  useEffect(() => () => { shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url)); }, []);

  function close() {
    setOpen(false);
    window.setTimeout(() => {
      shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url));
      setShots([]); setShotWarning(''); setDragging(false);
      setMessage(''); setSeverity('med'); setStatus('idle'); setError('');
    }, 200);
  }

  function addFiles(list: FileList | File[] | null | undefined) {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    setError('');
    setShots((prev) => {
      const next = [...prev];
      for (const file of incoming) {
        if (!SHOT_TYPES.includes(file.type)) {
          setError('Only PNG, JPEG, WebP or GIF images, please.');
          continue;
        }
        if (file.size > MAX_SHOT_BYTES) {
          setError('Each screenshot must be 8MB or less.');
          continue;
        }
        if (next.length >= MAX_SHOTS) {
          setError(`Up to ${MAX_SHOTS} screenshots per report.`);
          break;
        }
        next.push({ file, url: URL.createObjectURL(file) });
      }
      return next;
    });
  }

  function removeShot(url: string) {
    setShots((prev) => {
      const gone = prev.find((s) => s.url === url);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((s) => s.url !== url);
    });
  }

  function onPaste(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addFiles(files); }
  }

  async function uploadShots(itemId: string): Promise<boolean> {
    const form = new FormData();
    shotsRef.current.forEach((s) => form.append('files', s.file, s.file.name || 'screenshot.png'));
    try {
      const res = await fetch(`/api/bug-report/${itemId}/screenshots`, { method: 'POST', body: form });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function send() {
    const trimmed = message.trim();
    if (!trimmed) { setError('A few words first, please.'); ref.current?.focus(); return; }
    setStatus('sending'); setError(''); setShotWarning('');
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
      const data = await res.json().catch(() => null) as { id?: string | null } | null;
      if (shotsRef.current.length > 0) {
        const ok = data?.id ? await uploadShots(data.id) : false;
        if (!ok) setShotWarning('Report filed, but the screenshots could not be attached.');
      }
      setStatus('sent');
      window.setTimeout(close, 1800);
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
               onPaste={onPaste}
               onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
               onDragLeave={(e) => { if (e.target === e.currentTarget) setDragging(false); }}
               onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer?.files); }}
               className="w-full max-w-md border border-blood-800 bg-midnight-950 p-7 shadow-dramatic">
            <h2 className="font-display text-2xl font-black tracking-wide text-parchment-100">Found a fault?</h2>
            <p className="mt-1 text-sm text-parchment-200/70">
              Tell us what went wrong — it is filed straight to the record.
            </p>

            {status === 'sent' ? (
              <div className="mt-6 border border-blood-800 bg-blood-950/40 px-4 py-6 text-center text-sm text-parchment-100">
                Your report has been filed. With thanks.
                {shotWarning && <div className="mt-2 text-xs text-gold-400">{shotWarning}</div>}
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

                <span className="mt-4 block font-display text-[11px] font-bold uppercase tracking-[0.18em] text-gold-400">
                  Evidence — optional
                </span>
                <input ref={fileRef} type="file" multiple accept={SHOT_TYPES.join(',')} className="hidden"
                  onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
                <button type="button" onClick={() => fileRef.current?.click()}
                  className={`mt-2 w-full border border-dashed px-3 py-4 text-center text-xs transition
                             ${dragging ? 'border-blood-500 bg-blood-950/40 text-parchment-100' : 'border-midnight-700 bg-midnight-900 text-parchment-200/60 hover:border-blood-600 hover:text-parchment-100'}`}>
                  Click, drop or paste screenshots — up to {MAX_SHOTS}, 8MB each
                </button>

                {shots.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {shots.map((s) => (
                      <div key={s.url} className="relative h-16 w-16 border border-midnight-700 bg-midnight-900">
                        <img src={s.url} alt={s.file.name} className="h-full w-full object-cover" />
                        <button type="button" onClick={() => removeShot(s.url)} aria-label={`Remove ${s.file.name}`}
                          className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center border border-blood-600 bg-midnight-950
                                     text-[10px] font-bold leading-none text-parchment-100 hover:bg-blood-800">
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

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
