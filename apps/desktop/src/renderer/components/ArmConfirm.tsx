/**
 * Shown before a change that only the key could undo, when no key is inserted (see
 * lib/armConfirm.ts). Cancel is the default action: Escape, the backdrop and Close all decline.
 */
import { answerArming, useArmConfirm } from '../lib/armConfirm.js';
import { useFocusStore } from '../store/useFocusStore.js';
import { Button, Modal } from './ui/index.js';

export function ArmConfirm() {
  const pending = useArmConfirm((s) => s.pending);
  const emergencyEnabled = useFocusStore((s) => s.engine.emergencyEnabled);
  if (!pending) return null;
  const decline = () => answerArming(false);
  return (
    <Modal title="Your key isn’t inserted" onClose={decline} width={440}>
      <p className="text-body leading-relaxed text-slate-300">This change:</p>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-body text-slate-100">
        {pending.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="mt-3 text-body leading-relaxed text-slate-300">
        {emergencyEnabled
          ? 'Without your key you won’t be able to undo it — only an emergency unlock gets you out.'
          : 'Without your key you won’t be able to undo it. Emergency unlocks are turned off, so nothing else gets you out.'}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button autoFocus onClick={decline}>
          Cancel
        </Button>
        <Button variant="ghost" onClick={() => answerArming(true)}>
          Do it anyway
        </Button>
      </div>
    </Modal>
  );
}
