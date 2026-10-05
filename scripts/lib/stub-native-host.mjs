#!/usr/bin/env node
/**
 * A stand-in for the Talysman native host (`com.talysman.host`), for marketing captures.
 *
 *   node stub-native-host.mjs <state.json> [chrome-extension://…/]
 *
 * Chrome launches it when the extension calls connectNative. It answers `hello` with the state
 * frame in <state.json> — exactly what the daemon pushes when focus turns on — and acks
 * heartbeats so the extension reports itself connected. Nothing else: no service relay, no judge.
 * See `installStubNativeHost` in browser-capture.mjs for how a capture profile is pointed at it.
 */

import { readFileSync } from 'node:fs';

const state = JSON.parse(readFileSync(process.argv[2], 'utf8'));

function send(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

// Native messaging framing: a 4-byte little-endian length, then that many bytes of JSON.
let pending = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 4) {
    const length = pending.readUInt32LE(0);
    if (pending.length < 4 + length) break;
    const message = JSON.parse(pending.subarray(4, 4 + length).toString('utf8'));
    pending = pending.subarray(4 + length);
    if (message?.type === 'hello') send({ type: 'state', ...state });
    else if (message?.type === 'heartbeat') send({ type: 'heartbeatAck', sequence: message.sequence });
  }
});
process.stdin.on('end', () => process.exit(0));
