import { useState } from 'react';
import type { JudgePolicy, JudgeTask, Policy } from '@talysman/shared';
import { Input, Kicker, Select } from './ui/index.js';

const EMPTY_JUDGE: JudgePolicy = { tasks: [], avoid: [], fallback: 'allow' };

function newTaskId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * The AI filter: what you're working on (tasks) and what to steer clear of (avoid). Every rule set
 * to "AI" — the default for unlisted pages when "Judge everything else" is on, or a site feature
 * like Reddit posts — is checked against these. Tasks on their own are inert: with no rule set to
 * AI, blocking behaves exactly as if AI mode were off. Edits save on blur/Enter, not per keystroke, so a
 * half-typed task never reaches the judge.
 */
export function JudgeSettings({
  policy,
  allowed,
  onSave,
  onUpgrade,
}: {
  policy: Policy;
  /** AI filtering is available (flag + plan). */
  allowed: boolean;
  onSave: (next: Policy) => void;
  onUpgrade: () => void;
}) {
  const judge = policy.judge ?? EMPTY_JUDGE;
  const [taskDraft, setTaskDraft] = useState('');
  const [avoidDraft, setAvoidDraft] = useState('');

  function saveJudge(next: JudgePolicy) {
    if (!allowed) return onUpgrade();
    // A judge with no tasks has nothing to judge against: turn it off and stop judging the default.
    if (next.tasks.length === 0) {
      return onSave({
        ...policy,
        judge: null,
        defaultAction: policy.defaultAction === 'judge' ? 'allow' : policy.defaultAction,
      });
    }
    onSave({ ...policy, judge: next });
  }

  function addTask() {
    const title = taskDraft.trim();
    if (!title) return;
    const task: JudgeTask = { id: newTaskId(), title };
    if (!allowed) return onUpgrade();
    // Tasks alone change nothing: only rules set to AI (the "Smart" preset / the checkbox below,
    // or a site feature) send pages to the judge. So adding one never touches `defaultAction`.
    onSave({ ...policy, judge: { ...judge, tasks: [...judge.tasks, task] } });
    setTaskDraft('');
  }

  function updateTask(id: string, patch: Partial<JudgeTask>) {
    saveJudge({
      ...judge,
      tasks: judge.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)),
    });
  }

  function removeTask(id: string) {
    saveJudge({ ...judge, tasks: judge.tasks.filter((task) => task.id !== id) });
  }

  function addAvoid() {
    const item = avoidDraft.trim();
    if (!item || judge.avoid.includes(item)) return;
    saveJudge({ ...judge, avoid: [...judge.avoid, item] });
    setAvoidDraft('');
  }

  return (
    <div className="mt-3 rounded-[10px] border border-white/[0.07] bg-white/[0.02] p-3.5">
      <div className="flex items-baseline gap-2.5">
        <Kicker>AI filter</Kicker>
        {policy.judge && (
          <button
            onClick={() => saveJudge({ ...judge, tasks: [] })}
            className="ml-auto text-[11px] font-medium text-slate-500 transition hover:text-dangerInk"
          >
            turn off
          </button>
        )}
      </div>

      <div className="mt-2.5 flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-[11px] text-slate-450">What are you working on?</label>
          <ul className="flex flex-col gap-1.5">
            {judge.tasks.map((task) => (
              <li key={task.id} className="flex items-center gap-2">
                <Input
                  key={`${task.id}:${task.title}`}
                  defaultValue={task.title}
                  aria-label="Task"
                  onBlur={(e) => {
                    const title = e.target.value.trim();
                    if (title && title !== task.title) updateTask(task.id, { title });
                    if (!title) removeTask(task.id);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                />
                <button
                  onClick={() => removeTask(task.id)}
                  aria-label={`Remove task ${task.title}`}
                  className="text-[13px] text-slate-500 transition hover:text-dangerInk"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <Input
            className="mt-1.5"
            value={taskDraft}
            onChange={(e) => setTaskDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTask()}
            onBlur={addTask}
            placeholder={judge.tasks.length ? '+ Add another task' : 'Researching flight prices for a trip to Japan'}
            disabled={!allowed}
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] text-slate-450">Help me avoid</label>
          {judge.avoid.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {judge.avoid.map((item) => (
                <span
                  key={item}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.10] bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-slate-250"
                >
                  {item}
                  <button
                    onClick={() => saveJudge({ ...judge, avoid: judge.avoid.filter((x) => x !== item) })}
                    aria-label={`Stop avoiding ${item}`}
                    className="text-slate-500 hover:text-dangerInk"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <Input
            value={avoidDraft}
            onChange={(e) => setAvoidDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addAvoid()}
            onBlur={addAvoid}
            placeholder="Celebrity news, travel influencer content"
            disabled={!allowed || !policy.judge}
          />
        </div>

        {policy.judge && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-[11px] text-slate-400">
              <input
                type="checkbox"
                checked={policy.defaultAction === 'judge'}
                onChange={(e) => onSave({ ...policy, defaultAction: e.target.checked ? 'judge' : 'allow' })}
              />
              Judge every page that isn’t blocked or allowed below
            </label>
            <label className="flex items-center gap-2 text-[11px] text-slate-400">
              If the AI can’t answer
              <Select
                value={judge.fallback}
                onChange={(e) => saveJudge({ ...judge, fallback: e.target.value === 'block' ? 'block' : 'allow' })}
                className="w-auto py-1"
              >
                <option value="allow">allow the page</option>
                <option value="block">block the page</option>
              </Select>
            </label>
          </div>
        )}

        {!allowed ? (
          <button
            onClick={onUpgrade}
            className="self-start text-[11px] font-medium text-slate-400 transition hover:text-slate-200"
          >
            Upgrade to enable the AI filter →
          </button>
        ) : (
          <p className="text-[11px] leading-relaxed text-slate-450">
            Your tasks only apply where a rule is set to AI: tick the box above (or pick Smart) to
            judge every unlisted page, or set a site feature like Reddit posts to “AI”. Judged
            pages load, then get checked — usually within a few seconds.
          </p>
        )}
      </div>
    </div>
  );
}
