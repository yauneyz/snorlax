/**
 * A handful of hand-rolled UI primitives (kept light instead of a full shadcn install),
 * speaking the landing page's design language: near-black glass panels, hairline borders, a
 * cyan action signal, and monospaced small caps for anything instrument-like.
 */
import React from 'react';
import { cx } from '../../lib/utils.js';

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cx(
        'rounded-[14px] border border-white/[0.08] bg-gradient-to-br from-white/[0.045] to-white/[0.012] p-5 backdrop-blur-[2px] shadow-[0_1px_0_rgb(var(--color-white)/0.05)_inset,0_12px_34px_-22px_rgb(var(--color-black)/0.95)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** All-caps monospaced section label — the design's section voice. */
export function Kicker({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function CardTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        {children}
      </h2>
      {hint && <p className="mt-2 text-[12.5px] leading-relaxed text-slate-400">{hint}</p>}
    </div>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** `hero` is the light slug reserved for the one primary action on a screen. */
  variant?: 'primary' | 'hero' | 'ghost' | 'danger';
};

export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  const base =
    'inline-flex items-center justify-center rounded-full px-4 py-2 text-[12.5px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-45';
  const variants = {
    primary:
      'border border-signal bg-signal text-signalInk shadow-[0_8px_24px_rgb(var(--color-signal)/0.10)] hover:border-signalHi hover:bg-signalHi',
    hero:
      'border border-signal bg-signal text-signalInk shadow-[0_8px_28px_rgb(var(--color-signal)/0.13)] hover:border-signalHi hover:bg-signalHi',
    ghost:
      'border border-white/[0.10] bg-white/[0.04] text-slate-200 backdrop-blur-sm hover:bg-white/[0.08] hover:text-white',
    danger:
      'border border-danger/35 bg-danger/[0.12] text-dangerInk hover:border-danger/50 hover:bg-danger/[0.18]',
  };
  return <button className={cx(base, variants[variant], className)} {...props} />;
}

/** Small inline pill. Monospaced so ids, exe names and states all sit on the same rhythm. */
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'ok' | 'danger' | 'warn' | 'neutral';
}) {
  const tones = {
    ok: 'border-ok/30 bg-ok/[0.12] text-okInk',
    danger: 'border-danger/30 bg-danger/[0.12] text-dangerInk',
    warn: 'border-warn/30 bg-warn/[0.12] text-warn',
    neutral: 'border-white/[0.10] bg-white/[0.06] text-slate-300',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-medium tracking-[0.08em]',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

const FIELD =
  'w-full rounded-[9px] border border-white/[0.09] bg-white/[0.035] px-3 py-2 text-[12.5px] text-white outline-none transition placeholder:text-slate-600 focus:border-white/25 focus:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50';

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cx(FIELD, '[&>option]:bg-panel [&>option]:text-white', props.className)}
    />
  );
}

/**
 * Square colour chip identifying a blocking profile — the design's profile glyph is a
 * rounded square, kept visually distinct from the round status dots.
 */
export function ProfileDot({
  color,
  size = 8,
  glow = false,
  className,
}: {
  color: string;
  size?: number;
  glow?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cx('inline-block shrink-0 rounded-[2px]', className)}
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        ...(glow ? { boxShadow: `0 0 10px 2px ${color}55` } : {}),
      }}
    />
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(FIELD, props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(FIELD, 'resize-none', props.className)} />;
}

/** Centered dialog over a dimmed backdrop. Closing is left to the caller (Esc / backdrop). */
export function Modal({
  title,
  onClose,
  children,
  width = 460,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-[rgb(var(--color-background)/0.82)] backdrop-blur-md"
      />
      <div
        className="relative max-h-full overflow-y-auto rounded-[16px] border border-white/[0.10] bg-[rgb(var(--color-panel)/0.97)] p-5 shadow-[0_24px_60px_rgb(var(--color-black)/0.6)]"
        style={{ width }}
      >
        <div className="mb-3 flex items-center">
          <h2 className="text-[15px] font-semibold text-slate-100">{title}</h2>
          <button onClick={onClose} className="ml-auto rounded px-2 py-0.5 text-[12px] text-slate-400 hover:text-slate-200">
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * The circled "?" — hover or focus it for a one- or two-sentence explanation. Use sparingly: one
 * per concept a newcomer can't guess from its label, never on things that explain themselves.
 */
export function HelpTip({ children, label = 'What is this?' }: { children: React.ReactNode; label?: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className="flex h-[15px] w-[15px] items-center justify-center rounded-full border border-white/[0.16] text-[9.5px] font-semibold leading-none text-slate-450 transition hover:border-white/30 hover:text-slate-200 focus-visible:border-white/30 focus-visible:text-slate-200 focus-visible:outline-none"
      >
        ?
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-[calc(100%+7px)] z-30 w-[250px] -translate-x-1/2 rounded-[9px] border border-white/[0.12] bg-[rgb(var(--color-panel)/0.98)] px-3 py-2 text-left text-[11.5px] font-normal normal-case leading-relaxed tracking-normal text-slate-250 opacity-0 shadow-[0_12px_30px_rgb(var(--color-black)/0.55)] transition group-focus-within:opacity-100 group-hover:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}

/** Small on/off switch. Render inside a button (or pass `onClick`) — it's purely visual. */
export function Switch({ on, className }: { on: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'relative block h-5 w-9 shrink-0 rounded-full transition',
        on ? 'bg-seal/70' : 'bg-white/10',
        className,
      )}
    >
      <span
        className={cx(
          'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all',
          on ? 'left-[18px]' : 'left-0.5',
        )}
      />
    </span>
  );
}
