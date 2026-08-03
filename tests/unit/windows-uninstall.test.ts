import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Windows uninstall safety', () => {
  it('keeps the restartable service out of electron-builder app-process shutdown', () => {
    const nsis = read('native/windows/installer/nsis-include.nsh');
    const processCheck = nsis.match(
      /!macro customCheckAppRunning([\s\S]*?)!macroend/,
    )?.[1];

    expect(processCheck).toBeDefined();
    expect(processCheck).toContain('nsProcess::FindProcess "${APP_EXECUTABLE_FILENAME}"');
    expect(processCheck).toContain('nsProcess::KillProcess "talysman-natmsg.exe"');
    expect(processCheck).not.toContain('nsProcess::KillProcess "talysman-svc.exe"');
  });

  it('stops the legacy service gracefully before invoking a broken old uninstaller', () => {
    const nsis = read('native/windows/installer/nsis-include.nsh');
    const processCheck = nsis.match(
      /!macro customCheckAppRunning([\s\S]*?)!macroend/,
    )?.[1];

    expect(processCheck).toBeDefined();
    expect(processCheck).toContain('${If} ${isUpdated}');
    expect(processCheck).toContain('talysman-svcctl.exe" stop');
    expect(processCheck).toContain('nsProcess::FindProcess "talysman-svc.exe"');
    expect(processCheck).not.toContain('nsProcess::KillProcess "talysman-svc.exe"');
  });

  it('does not delete application files when service removal fails', () => {
    const nsis = read('native/windows/installer/nsis-include.nsh');
    const uninstall = nsis.match(/!macro customUnInstall([\s\S]*?)!macroend/)?.[1];

    expect(uninstall).toBeDefined();
    expect(uninstall).toContain('talysman-svcctl.exe" uninstall');
    expect(uninstall).toMatch(/Pop \$0[\s\S]*?\$0 != 0[\s\S]*?Abort/);
  });

  it('waits for a stopped service and tears down enforcement before deletion', () => {
    const controller = read('native/windows/src/bin/svcctl.rs');
    const uninstall = controller.match(/fn uninstall\(\) -> Result<\(\)> \{([\s\S]*?)\n\}/)?.[1];

    expect(uninstall).toBeDefined();
    expect(uninstall).toContain('stop_if_running(service)');
    expect(uninstall).toContain('talysman::enforce::teardown_network()');
    expect(uninstall).toContain('state.focus_active = false');
    expect(uninstall!.indexOf('stop_if_running(service)')).toBeLessThan(
      uninstall!.indexOf('service.delete()'),
    );
  });

  it('bounds the service safety check instead of hanging indefinitely', () => {
    const controller = read('native/windows/src/bin/svcctl.rs');

    expect(controller).toContain('tokio::time::timeout(Duration::from_secs(5)');
    expect(controller).toContain('service timed out during uninstall safety check');
  });

  it('gates Windows publishing on a real install/uninstall smoke test', () => {
    const workflow = read('.github/workflows/release-desktop.yml');
    const build = workflow.indexOf('name: Build signed Windows installer');
    const smoke = workflow.indexOf('name: Smoke-test Windows uninstall');
    const publish = workflow.indexOf('name: Publish verified Windows installer');

    expect(build).toBeGreaterThan(-1);
    expect(smoke).toBeGreaterThan(build);
    expect(publish).toBeGreaterThan(smoke);
    expect(workflow).toContain('smoke-windows-uninstall.ps1');
    expect(workflow).toContain('release:upload -- --no-build --require win');
  });
});
