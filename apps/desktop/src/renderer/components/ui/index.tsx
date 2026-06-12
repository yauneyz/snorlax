/** A handful of hand-rolled UI primitives (kept light instead of a full shadcn install). */
import React from 'react';
import { cx } from '../../lib/utils.js';

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cx('rounded-xl border border-border bg-panel p-5 shadow-lg', className)}>
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
    primary: 'bg-accent text-white hover:bg-indigo-500',
    ghost: 'bg-panel2 text-slate-200 hover:bg-[#222c42] border border-border',
    danger: 'bg-danger text-white hover:bg-red-500',
  };
  return <button className={cx(base, variants[variant], className)} {...props} />;
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'ok' | 'danger' | 'neutral' }) {
  const tones = {
    ok: 'bg-green-500/15 text-green-400 border-green-500/30',
    danger: 'bg-red-500/15 text-red-400 border-red-500/30',
    neutral: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
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
        'w-full rounded-lg border border-border bg-panel2 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-accent',
        props.className,
      )}
    />
  );
}
