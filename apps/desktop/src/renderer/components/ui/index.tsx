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
        'surface-card p-5 backdrop-blur-[2px]',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** All-caps monospaced label for metadata. */
export function Kicker({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'font-mono text-caption font-semibold uppercase tracking-[0.16em] text-slate-400',
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
      <h2 className="text-heading font-semibold tracking-[-0.01em] text-slate-100">
        {children}
      </h2>
      {hint && <p className="mt-2 text-body leading-relaxed text-slate-400">{hint}</p>}
    </div>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** `hero` is the light slug reserved for the one primary action on a screen. */
  variant?: 'primary' | 'hero' | 'ghost' | 'danger';
};

export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  const base =
    'inline-flex items-center justify-center rounded-full px-4 py-2 text-body font-semibold transition duration-150 enabled:active:translate-y-px enabled:active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-45';
  // The filled variants are lit from above (an inset highlight) and cast their own colour below.
  const variants = {
    primary:
      'border border-signal bg-gradient-to-b from-signalHi/90 via-signal to-signal text-signalInk shadow-[inset_0_1px_0_rgb(var(--color-white)/0.45),0_10px_26px_-10px_rgb(var(--color-signal)/0.55)] enabled:hover:border-signalHi enabled:hover:shadow-[inset_0_1px_0_rgb(var(--color-white)/0.55),0_12px_32px_-8px_rgb(var(--color-signal)/0.7)] enabled:hover:brightness-110',
    hero:
      'border border-signal bg-gradient-to-b from-signalHi/90 via-signal to-signal text-signalInk shadow-[inset_0_1px_0_rgb(var(--color-white)/0.45),0_14px_36px_-10px_rgb(var(--color-signal)/0.6)] enabled:hover:border-signalHi enabled:hover:shadow-[inset_0_1px_0_rgb(var(--color-white)/0.55),0_16px_44px_-8px_rgb(var(--color-signal)/0.78)] enabled:hover:brightness-110',
    ghost:
      'border border-white/[0.10] bg-white/[0.045] text-slate-200 shadow-[inset_0_1px_0_rgb(var(--color-white)/0.06)] backdrop-blur-sm hover:border-white/[0.18] hover:bg-white/[0.085] hover:text-white',
    danger:
      'border border-danger/35 bg-danger/[0.12] text-dangerInk shadow-[inset_0_1px_0_rgb(var(--color-white)/0.05)] hover:border-danger/55 hover:bg-danger/[0.2]',
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
        'inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-caption font-medium tracking-[0.08em]',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

const FIELD =
  'w-full rounded-[10px] border border-white/[0.09] bg-black/25 px-3 py-2 text-body text-white shadow-[inset_0_1px_2px_rgb(var(--color-black)/0.5)] outline-none transition placeholder:text-slate-600 hover:border-white/[0.14] focus:border-signal/60 focus:bg-black/35 focus:shadow-[inset_0_1px_2px_rgb(var(--color-black)/0.5),0_0_0_3px_rgb(var(--color-signal)/0.14)] disabled:cursor-not-allowed disabled:opacity-50';

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
        className="absolute inset-0 bg-[rgb(var(--color-background)/0.78)] backdrop-blur-md"
      />
      <div
        className="relative max-h-full animate-rise overflow-y-auto rounded-[18px] border border-white/[0.10] bg-[linear-gradient(180deg,rgb(var(--color-panel-raised)/0.98),rgb(var(--color-panel)/0.98))] p-5 shadow-[inset_0_1px_0_rgb(var(--color-white)/0.08),0_32px_80px_rgb(var(--color-black)/0.7),0_0_0_1px_rgb(var(--color-black)/0.4)]"
        style={{ width }}
      >
        <div className="mb-3 flex items-center">
          <h2 className="text-heading font-semibold text-slate-100">{title}</h2>
          <button onClick={onClose} className="ml-auto rounded-full px-2.5 py-1 text-caption text-slate-400 transition hover:bg-white/[0.06] hover:text-slate-100">
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
        className="flex h-[15px] w-[15px] items-center justify-center rounded-full border border-white/[0.16] text-caption font-semibold leading-none text-slate-450 transition hover:border-white/30 hover:text-slate-200 focus-visible:border-white/30 focus-visible:text-slate-200 focus-visible:outline-none"
      >
        ?
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-[calc(100%+7px)] z-30 w-[250px] -translate-x-1/2 rounded-[9px] border border-white/[0.12] bg-[rgb(var(--color-panel)/0.98)] px-3 py-2 text-left text-caption font-normal normal-case leading-relaxed tracking-normal text-slate-250 opacity-0 shadow-[0_12px_30px_rgb(var(--color-black)/0.55)] transition group-focus-within:opacity-100 group-hover:opacity-100"
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
        'relative block h-5 w-9 shrink-0 rounded-full shadow-[inset_0_1px_2px_rgb(var(--color-black)/0.45)] transition',
        on ? 'bg-seal/80 shadow-[inset_0_1px_2px_rgb(var(--color-black)/0.25),0_0_12px_rgb(var(--color-signal)/0.35)]' : 'bg-white/10',
        className,
      )}
    >
      <span
        className={cx(
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgb(var(--color-black)/0.5)] transition-all',
          on ? 'left-[18px]' : 'left-0.5',
        )}
      />
    </span>
  );
}

/** Enabled state is always readable without relying on color. */
export function StatusLabel({ on, tone = 'signal' }: { on: boolean; tone?: 'signal' | 'success' | 'danger' }) {
  const tones = {
    signal: { text: 'text-signal', dot: 'bg-signal' },
    success: { text: 'text-okInk', dot: 'bg-ok' },
    danger: { text: 'text-dangerInk', dot: 'bg-danger' },
  };
  const colors = tones[tone];
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-2 text-caption font-medium', on ? colors.text : 'text-slate-450')}>
      <span aria-hidden="true" className={cx('h-2 w-2 shrink-0 rounded-full', on ? cx(colors.dot, 'shadow-[0_0_8px_currentColor]') : 'bg-white/20')} />
      {on ? 'On' : 'Off'}
    </span>
  );
}
