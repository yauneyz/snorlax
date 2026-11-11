/**
 * Confirms switching emergency unlocks off or back on. Both directions are key-gated in the
 * engine; turning them off is the one setting that can leave you with no way out but the key,
 * so that direction spells out what you're giving up. Cancel is the default action.
 */
import { useState } from 'react';
import { ErrorCode } from '@talysman/shared';
import { useFocusStore } from '../store/useFocusStore.js';
import { runCommand } from '../lib/engine.js';
import { Button, Modal } from './ui/index.js';

export function EmergencyToggleConfirm({ enable, onClose }: { enable: boolean; onClose: () => void }) {
  const keyPresent = useFocusStore((s) => s.keyPresent);
  const hasPairedKeys = useFocusStore((s) => s.pairedKeys.length > 0);
  // With every key unpaired the engine lets them back on keylessly, so nobody is stranded.
  const needsKey = !keyPresent && !(enable && !hasPairedKeys);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await runCommand({ type: 'setEmergencyUnlocksEnabled', enabled: enable });
      onClose();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(code === ErrorCode.KEY_REQUIRED ? 'Insert your paired USB key to change this.' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={enable ? 'Turn emergency unlocks back on?' : 'Turn off emergency unlocks?'} onClose={onClose} width={440}>
      {enable ? (
        <p className="text-body leading-relaxed text-slate-300">
          You’ll be able to use your remaining emergency unlocks again to turn everything off without your key.
        </p>
      ) : (
        <>
          <p className="text-body leading-relaxed text-slate-300">
            With emergency unlocks off, your paired USB key becomes the <strong className="text-slate-100">only</strong>{' '}
            way to turn blocking off or loosen a mode. Locked windows can’t be ended early at all.
          </p>
          <p className="mt-2 text-body leading-relaxed text-warn">
            If you lose or break your key, you won’t be able to get out of blocking on this device. Turning them back
            on needs the key too.
          </p>
        </>
      )}
      {needsKey && <p className="mt-3 text-caption text-slate-450">Insert your paired USB key to continue.</p>}
      {error && <p className="mt-3 text-caption text-dangerInk">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button autoFocus onClick={onClose}>
          Cancel
        </Button>
        <Button variant={enable ? 'primary' : 'danger'} disabled={busy || needsKey} onClick={() => void confirm()}>
          {enable ? 'Turn on' : 'Turn off emergency unlocks'}
        </Button>
      </div>
    </Modal>
  );
}
