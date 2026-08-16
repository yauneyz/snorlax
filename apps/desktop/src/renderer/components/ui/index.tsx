/**
 * A handful of hand-rolled UI primitives (kept light instead of a full shadcn install),
 * speaking the "seal" design language: near-black glass panels, hairline borders, green/red
 * status signals, and monospaced small caps for anything instrument-like.
 */
import React from 'react';
import { cx } from '../../lib/utils.js';

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cx(
        'rounded-xl border border-white/[0.07] bg-white/[0.02] p-5 backdrop-blur-[2px] shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_10px_30px_-18px_rgba(0,0,0,0.9)]',
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
        'font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500',
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
      <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
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
    'inline-flex items-center justify-center rounded-[9px] px-4 py-2 text-[12.5px] font-semibold transition disabled:opacity-45 disabled:cursor-not-allowed';
  const variants = {
    primary:
      'border border-seal/30 bg-seal/[0.12] text-sealInk hover:border-seal/45 hover:bg-seal/[0.18]',
    hero: 'bg-gradient-to-b from-white to-accent text-accentInk shadow-[0_1px_0_rgba(255,255,255,0.4)_inset] hover:from-white hover:to-slate-100',
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
