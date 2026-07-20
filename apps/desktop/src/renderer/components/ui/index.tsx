/** A handful of hand-rolled UI primitives (kept light instead of a full shadcn install). */
import React from 'react';
import { cx } from '../../lib/utils.js';

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cx(
        'rounded-xl border border-white/[0.07] bg-panel p-5 shadow-[0_1px_0_rgba(255,255,255,0.05)_inset,0_8px_24px_-12px_rgba(0,0,0,0.9)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-lg font-semibold text-white">{children}</h2>
      {hint && <p className="mt-1 text-sm text-slate-400">{hint}</p>}
    </div>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger';
};

export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  const base =
    'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed';
  const variants = {
    primary:
      'bg-gradient-to-b from-white to-accent text-accentInk hover:from-white hover:to-slate-100 shadow-[0_1px_0_rgba(255,255,255,0.4)_inset]',
    ghost:
      'border border-white/[0.09] bg-white/[0.04] text-slate-200 backdrop-blur-sm hover:bg-white/[0.08] hover:text-white',
    danger: 'bg-danger text-white hover:bg-red-500',
  };
  return <button className={cx(base, variants[variant], className)} {...props} />;
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'ok' | 'danger' | 'neutral' }) {
  const tones = {
    ok: 'bg-green-500/15 text-green-400 border-green-500/30',
    danger: 'bg-red-500/15 text-red-400 border-red-500/30',
    neutral: 'bg-white/[0.06] text-slate-300 border-white/[0.10]',
  };
  return (
    <span className={cx('rounded-full border px-2.5 py-0.5 text-xs font-medium', tones[tone])}>
      {children}
    </span>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        'w-full rounded-lg border border-white/[0.09] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-white/25 focus:bg-white/[0.05]',
        props.className,
      )}
    />
  );
}
