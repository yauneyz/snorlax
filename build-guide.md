# FocusLock — Build & Run Guide (Windows)

This walks you from a clean Windows machine to a running FocusLock dev build, then to a packaged
installer, and shows how to use the **recovery killswitch** so you can never lock yourself out.

> **Why native Windows?** The Electron app and the Rust service link Win32 APIs, use Windows
> named pipes, and register as a Windows Service. None of that runs inside WSL. Edit code
> wherever you like, but **build and run on Windows.**

---

## 0. Move the code onto the Windows filesystem

If the repo currently lives under WSL (`/home/...`), copy it to a native Windows path — builds
are much faster and you avoid line-ending/permission weirdness:

```powershell
# from a Windows PowerShell prompt
robocopy \\wsl$\Ubuntu\home\zac\development\snorlax C:\dev\snorlax /E
cd C:\dev\snorlax
```

(Or just `git clone` it to `C:\dev\snorlax` once it's in a repo.)

---

## 1. Install the toolchain (one time)

### Node.js + pnpm
1. Install **Node.js 20 LTS** from <https://nodejs.org> (or `winget install OpenJS.NodeJS.LTS`).
2. Enable pnpm:
   ```powershell
   corepack enable
   corepack prepare pnpm@9.7.0 --activate
   pnpm --version   # should print 9.x
   ```

### Rust (MSVC toolchain)
1. Install **rustup** from <https://rustup.rs> (`winget install Rustlang.Rustup`).
2. Ensure the MSVC target is default:
   ```powershell
   rustup default stable-x86_64-pc-windows-msvc
   cargo --version
   ```

### Visual Studio Build Tools (C++)
The Rust service links Win32 libraries, so you need the MSVC linker + Windows SDK:
1. Install **Visual Studio Build Tools** (`winget install Microsoft.VisualStudio.2022.BuildTools`).
2. In the installer, select the **“Desktop development with C++”** workload (this includes the
   Windows 10/11 SDK). Finish and reboot if prompted.

---

## 2. Install project dependencies

```powershell
cd C:\dev\snorlax
pnpm install
```

Sanity-check the parts that don't need Windows privileges:

```powershell
pnpm typecheck     # TS project references + app typecheck
pnpm test          # Category-1 unit tests (schedule engine, policy, pairing, config, mock)
```

Both should pass before you go further.

---

## 3. Dev loop (fast inner loop)

There are two pieces: the **UI** (Electron) and the **service** (Rust).

### 3a. Run the UI alone (no admin, works immediately)
```powershell
pnpm dev
```
The app launches. If it can't reach the real service over the named pipe, it **automatically
falls back to an in-process mock**, so every screen works right away. In the mock you can
simulate the USB key from **Settings → Developer → Toggle simulated USB key** (or the tray
menu) to see the red/green indicator and the “insert your key” disable gate.

### 3b. Run the real service in console mode (to test real blocking)
Open a **second terminal as Administrator** (real DNS/firewall changes need elevation):
```powershell
cd C:\dev\snorlax
cargo run --manifest-path native\windows\Cargo.toml --bin focuslock-svc -- --console
```
This runs the service in the foreground on the **dev pipe** (`focuslock-dev`). Now `pnpm dev`
(also started with `APP_ENV=development`) will connect to it instead of the mock, and toggling
focus performs real enforcement. Type `quit` in the service console to stop it.

> Without Administrator rights the service still runs and serves IPC, but DNS/firewall actions
> no-op with a logged warning — fine for UI work, not for verifying real blocking.

---

## 4. Build the installer (packaged, real service)

```powershell
pnpm build:win
```
This runs `scripts/build.mjs`, which:
1. builds the Rust service in release and stages the three `.exe`s into
   `apps/desktop/resources/bin/win/`,
2. builds the Electron bundles (`electron-vite build`),
3. packages an **NSIS installer** into `dist\` and embeds the service binaries.

Run the installer (`dist\FocusLock-Setup-0.1.0.exe`) — it will prompt for elevation, register
and start the `FocusLockSvc` service, and **generate your recovery code**.

> ⚠️ **Save the recovery code.** The installer shows it and writes it to
> `C:\ProgramData\FocusLock\recovery-code.txt`. Copy it somewhere safe, then you may delete the
> file. This code is your safety net (see §6).

---

## 5. Verify it actually enforces (manual checklist)

With focus **on** (from the app):

- **Domain block:** add `youtube.com` to the blocklist, turn focus on, then:
  ```powershell
  nslookup youtube.com 127.0.0.1     # → NXDOMAIN / 0.0.0.0 (sinkholed)
  nslookup example.com 127.0.0.1     # → resolves normally (allowed, forwarded upstream)
  ```
  Editing `C:\Windows\System32\drivers\etc\hosts` changes nothing — FocusLock doesn't read it.
- **App block:** add `notepad.exe`, turn focus on, launch Notepad → it gets terminated within ~1s.
- **USB gate:** pair a USB stick on the **Keys** page, turn focus on, remove the stick, and try
  to turn focus off → refused with “insert your key”. Re-insert → it turns off.
- **Auto-restart:** kill `focuslock-svc.exe` in Task Manager → the SCM restarts it within ~1s
  (`sc query FocusLockSvc` shows it RUNNING again).

---

## 6. The killswitch (don't panic)

If you ever get locked out — bug, lost USB key, locked schedule window — you have a backdoor:

```powershell
# run as Administrator
"C:\Program Files\FocusLock\resources\bin\focuslock-recover.exe" --code XXXX-XXXX-XXXX
```
It first asks the running service to force-disable focus and tear down enforcement. If the
service is wedged/unreachable, it verifies your code locally and **directly** restores DNS,
removes the firewall rules, and stops the service. Either way focus is released without the USB
key. (You can also run `focuslock-svcctl.exe gen-code` as admin to mint a fresh code.)

### Absolute last resort
If everything is broken and you can't even run recover:
1. Boot Windows into **Safe Mode** (services don't auto-start there).
2. Remove the service and undo settings:
   ```powershell
   sc stop FocusLockSvc
   sc delete FocusLockSvc
   netsh advfirewall firewall delete rule name=FocusLock-DoT-TCP
   netsh advfirewall firewall delete rule name=FocusLock-DoT-UDP
   Get-NetAdapter -Physical | Set-DnsClientServerAddress -ResetServerAddresses
   ```
3. Reboot normally. You cannot brick the machine — these steps always recover it.

---

## 7. Uninstall

Use **Settings → Apps** or run the uninstaller. It refuses to remove the service while focus is
actively enforced and no key is present (insert your key or run the killswitch first), then
deletes the service and removes its rules.

---

## Troubleshooting

- **`link.exe` not found / build fails in `cargo`:** the VS Build Tools C++ workload isn't
  installed — re-run the VS installer and add “Desktop development with C++”.
- **Port 53 bind fails:** another local resolver/VPN is using it. Stop it, or note that the
  service logs this and disables DNS enforcement for that session. Logs:
  `C:\ProgramData\FocusLock\service.log`.
- **A crate API mismatch on first `cargo build`:** the service pins specific versions of the
  `windows`, `windows-service`, and `sysinfo` crates. If a transitive update shifts an API
  (e.g. a `windows-service` method name or a `GetVolumeInformationW` argument), `cargo` points
  at the exact line — these are small, localized fixes. Pin versions in `Cargo.lock` once it
  builds clean so the toolchain stays reproducible.
- **The app shows “mock service”:** it couldn't reach the real service pipe. Make sure
  `focuslock-svc` is running (console mode in dev, or the installed service in prod) and that
  `APP_ENV`/`FOCUSLOCK_PIPE` match (dev uses `focuslock-dev`, prod uses `focuslock`).
