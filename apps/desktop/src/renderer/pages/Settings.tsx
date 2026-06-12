import React from 'react';
import { useFocusStore } from '../store/useFocusStore.js';
import { devToggleKey } from '../lib/bridge.js';
import { Badge, Button, Card, CardTitle } from '../components/ui/index.js';

export function Settings() {
  const appEnv = useFocusStore((s) => s.appEnv);
  const usingMock = useFocusStore((s) => s.usingMock);
  const serviceVersion = useFocusStore((s) => s.serviceVersion);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <CardTitle>About</CardTitle>
        <div className="flex flex-col gap-2 text-sm text-slate-300">
          <div>
            Environment: <Badge tone="neutral">{appEnv}</Badge>
          </div>
          <div>
            Service: <Badge tone={usingMock ? 'neutral' : 'ok'}>{usingMock ? 'mock (in-process)' : 'native'}</Badge>
          </div>
          <div>Service version: {serviceVersion}</div>
        </div>
      </Card>

      {usingMock && (
        <Card>
          <CardTitle hint="Only available against the in-process mock service.">Developer</CardTitle>
          <p className="mb-3 text-sm text-slate-400">
            Simulate plugging/unplugging the paired USB key to test the red/green indicator and
            the key-required disable gate.
          </p>
          <Button variant="ghost" onClick={() => devToggleKey()}>
            Toggle simulated USB key
          </Button>
        </Card>
      )}
    </div>
  );
}
