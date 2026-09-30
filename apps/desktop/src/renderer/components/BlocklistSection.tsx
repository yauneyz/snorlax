import React, { useEffect, useRef } from 'react';
import { cx } from '../lib/utils.js';
import { HelpTip } from './ui/index.js';

/**
 * One collapsible block on the Blocklists page. Collapsed it's a single row — title, an optional
 * "?", a one-line summary of what's in effect, and a few preview chips — so the whole page fits on
 * one screen. Expanded it holds that section's editor; opening one scrolls it to the top of the
 * page scroller so the editor gets the full height below it.
 */
export function BlocklistSection({
  title,
  help,
  active,
  summary,
  chips = [],
  badge,
  open,
  onToggle,
  children,
}: {
  title: string;
  /** Tooltip text for the "?" next to the title; omit when the title explains itself. */
  help?: React.ReactNode;
  /** Something in this section is doing work — lights the status dot. */
  active: boolean;
  summary: React.ReactNode;
  /** Short labels previewing the section's contents while collapsed. */
  chips?: string[];
  /** Replaces the chips — e.g. a Pro badge on a locked section. */
  badge?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = React.useId();

  useEffect(() => {
    if (!open) return;
    // Wait a frame so a section collapsing above this one has already shrunk.
    const raf = requestAnimationFrame(() =>
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
    return () => cancelAnimationFrame(raf);
  }, [open]);

  return (
    <div
      ref={ref}
      className={cx(
        'scroll-mt-3 rounded-xl border transition-colors',
        open ? 'border-white/[0.12] bg-white/[0.03]' : 'border-white/[0.07] bg-white/[0.02]',
      )}
    >
      {/* The row itself toggles; the "?" stops propagation so hovering help never opens it. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className={cx(
          'flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl px-4 py-2.5 transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/25',
          !open && 'hover:bg-white/[0.025]',
        )}
      >
        <span
          aria-hidden
          className={cx(
            'block h-1.5 w-1.5 shrink-0 rounded-full',
            active ? 'bg-signal shadow-[0_0_8px_rgb(var(--color-signal)/0.55)]' : 'bg-white/15',
          )}
        />
        <span className="shrink-0 text-[13.5px] font-semibold text-slate-100">{title}</span>
        {help && <HelpTip label={`About ${title.toLowerCase()}`}>{help}</HelpTip>}
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-slate-450">{summary}</span>
        {!open &&
          (badge ?? (
            <span className="hidden shrink-0 items-center gap-1 md:flex">
              {chips.slice(0, 3).map((chip) => (
                <span
                  key={chip}
                  className="max-w-[150px] truncate rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[10.5px] text-slate-300"
                >
                  {chip}
                </span>
              ))}
              {chips.length > 3 && (
                <span className="text-[10.5px] text-slate-500">+{chips.length - 3}</span>
              )}
            </span>
          ))}
        <span
          className={cx(
            'shrink-0 text-[11.5px] font-medium',
            open ? 'text-slate-200' : 'text-slate-400',
          )}
        >
          {open ? 'Done' : 'Edit'}
        </span>
        <span
          aria-hidden
          className={cx('shrink-0 text-[11px] text-slate-500 transition-transform', open && 'rotate-180')}
        >
          ▾
        </span>
      </div>

      {open && (
        <div id={id} className="animate-rise border-t border-white/[0.06] px-4 pb-4 pt-3.5">
          {children}
        </div>
      )}
    </div>
  );
}
