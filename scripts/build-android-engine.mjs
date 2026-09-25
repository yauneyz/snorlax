#!/usr/bin/env node
// Builds the Rust engine for Talysman for Android:
//   <out>/jniLibs/<abi>/libtalysman_engine_ffi.so   (arm64-v8a, armeabi-v7a, x86_64 via cargo-ndk)
//   <out>/kotlin/uniffi/talysman_engine_ffi/*.kt    (uniffi Kotlin bindings)
// Called by the :engine Gradle module (apps/android/engine) with the output directory as argv[2].
// Needs cargo with the three Android targets, cargo-ndk, and ANDROID_NDK_HOME (or the NDK under
// the SDK's ndk/ directory). See apps/android/README.md.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const crate = path.join(root, 'native/engine-ffi');
const out = path.resolve(process.argv[2] ?? path.join(root, 'apps/android/engine/build/rust'));

function ndkHome() {
  if (process.env.ANDROID_NDK_HOME) return process.env.ANDROID_NDK_HOME;
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  const ndkDir = sdk && path.join(sdk, 'ndk');
  if (ndkDir && existsSync(ndkDir)) {
    const versions = readdirSync(ndkDir).sort();
    if (versions.length) return path.join(ndkDir, versions[versions.length - 1]);
  }
  throw new Error('Set ANDROID_NDK_HOME (NDK r27+) to build the Android engine.');
}

const env = { ...process.env, ANDROID_NDK_HOME: ndkHome() };
const run = (cmd, args) => execFileSync(cmd, args, { cwd: crate, stdio: 'inherit', env });

run('cargo', ['ndk', '-t', 'arm64-v8a', '-t', 'armeabi-v7a', '-t', 'x86_64', '-o', path.join(out, 'jniLibs'), 'build', '--release', '--lib']);
// Bindings are read from an unstripped host (debug) build of the same crate (library mode); the
// release profile strips the metadata symbols uniffi reads.
run('cargo', ['build', '--lib']);
const hostLib = path.join(crate, 'target/debug', process.platform === 'darwin' ? 'libtalysman_engine_ffi.dylib' : 'libtalysman_engine_ffi.so');
run('cargo', ['run', '--bin', 'uniffi-bindgen', '--', 'generate', '--library', hostLib, '--language', 'kotlin', '--out-dir', path.join(out, 'kotlin'), '--no-format']);
console.log(`Android engine built into ${out}`);
