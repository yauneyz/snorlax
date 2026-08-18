import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@talysman/shared';

const root = resolve(__dirname, '../..');

describe('service protocol version', () => {
  it('stays synchronized across the TypeScript contract, schema, and native services', () => {
    const schema = JSON.parse(
      readFileSync(resolve(root, 'native/protocol/schema.json'), 'utf8'),
    ) as { protocolVersion: number };
    expect(schema.protocolVersion).toBe(PROTOCOL_VERSION);

    for (const platform of ['linux', 'macos', 'windows']) {
      const constants = readFileSync(
        resolve(root, `native/${platform}/src/constants.rs`),
        'utf8',
      );
      const match = constants.match(/pub const PROTOCOL_VERSION: u32 = (\d+);/);
      expect(match?.[1], `${platform} protocol constant`).toBe(String(PROTOCOL_VERSION));
    }
  });
});
