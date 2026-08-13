//! Standalone Linux tray helper. Connects directly to the daemon's Unix socket (same NDJSON-RPC
//! protocol as `natmsg.rs`) and renders a StatusNotifierItem via `ksni` — pure Rust D-Bus, no GTK
//! or libappindicator, so it costs essentially nothing to keep running independent of the
//! Electron app. Green icon while blocking is active, gray while it's off; hidden entirely when
//! `settings.trayIconEnabled` is false.

use std::time::Duration;

use ksni::TrayMethods;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

use talysman::constants::{socket_path, PIPE_BASE_DEV, PIPE_BASE_PROD};

struct TalysmanTray {
    blocking_active: bool,
    icon_green: ksni::Icon,
    icon_gray: ksni::Icon,
}

impl ksni::Tray for TalysmanTray {
    fn id(&self) -> String {
        "talysman-tray".into()
    }

    fn title(&self) -> String {
        "Talysman".into()
    }

    fn icon_pixmap(&self) -> Vec<ksni::Icon> {
        vec![if self.blocking_active {
            self.icon_green.clone()
        } else {
            self.icon_gray.clone()
        }]
    }

    fn menu(&self) -> Vec<ksni::MenuItem<Self>> {
        use ksni::menu::StandardItem;
        vec![
            StandardItem {
                label: if self.blocking_active {
                    "Blocking active".into()
                } else {
                    "Blocking disabled".into()
                },
                enabled: false,
                ..Default::default()
            }
            .into(),
            ksni::MenuItem::Separator,
            StandardItem {
                label: "Open Talysman".into(),
                // The app's single-instance lock means this either focuses the running window
                // or launches a fresh one.
                activate: Box::new(|_| {
                    let _ = std::process::Command::new("talysman").spawn();
                }),
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: "Quit".into(),
                // Exits this helper only — the daemon is an independent systemd service.
                activate: Box::new(|_| std::process::exit(0)),
                ..Default::default()
            }
            .into(),
        ]
    }
}

/// Decode an embedded PNG into ksni's `Icon` (ARGB32, network byte order). RGBA -> ARGB is a
/// per-pixel byte rotation, same as ksni's own custom_icon.rs example.
fn load_icon(bytes: &[u8]) -> ksni::Icon {
    let img = image::load_from_memory_with_format(bytes, image::ImageFormat::Png)
        .expect("bundled tray icon is a valid PNG");
    let width = img.width() as i32;
    let height = img.height() as i32;
    let mut data = img.into_rgba8().into_vec();
    for pixel in data.chunks_exact_mut(4) {
        pixel.rotate_right(1); // rgba -> argb (network byte order, per the SNI spec)
    }
    ksni::Icon {
        width,
        height,
        data,
    }
}

/// Applies the daemon's current view of the world to the running tray: spawns/updates/tears down
/// the ksni service as `enabled` and `active` change. Keeping the socket connection open
/// regardless of `enabled` means toggling the Settings checkbox in Electron takes effect live,
/// without restarting this process.
async fn sync_tray(
    handle: &mut Option<ksni::Handle<TalysmanTray>>,
    enabled: bool,
    active: bool,
    icon_green: &ksni::Icon,
    icon_gray: &ksni::Icon,
) {
    match (enabled, handle.as_ref()) {
        (true, None) => {
            let tray = TalysmanTray {
                blocking_active: active,
                icon_green: icon_green.clone(),
                icon_gray: icon_gray.clone(),
            };
            match tray.spawn().await {
                Ok(h) => *handle = Some(h),
                Err(e) => tracing::warn!("[tray] failed to register tray: {e}"),
            }
        }
        (true, Some(h)) => {
            h.update(|t| t.blocking_active = active).await;
        }
        (false, Some(_)) => {
            if let Some(h) = handle.take() {
                h.shutdown().await;
            }
        }
        (false, None) => {}
    }
}

async fn pump_socket(
    handle: &mut Option<ksni::Handle<TalysmanTray>>,
    enabled: &mut bool,
    active: &mut bool,
    icon_green: &ksni::Icon,
    icon_gray: &ksni::Icon,
) -> std::io::Result<()> {
    let client = match UnixStream::connect(socket_path(PIPE_BASE_PROD)).await {
        Ok(client) => client,
        Err(_) => UnixStream::connect(socket_path(PIPE_BASE_DEV)).await?,
    };

    let (reader, mut writer) = tokio::io::split(client);
    writer
        .write_all(b"{\"kind\":\"request\",\"id\":1,\"method\":\"getState\",\"params\":null}\n")
        .await?;

    let mut lines = BufReader::new(reader).lines();
    while let Some(line) = lines.next_line().await? {
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            continue;
        };

        let mut changed = false;
        match v.get("kind").and_then(|k| k.as_str()) {
            Some("response")
                if v.get("ok").and_then(|o| o.as_bool()) == Some(true)
                    && v.get("id").and_then(|i| i.as_i64()) == Some(1) =>
            {
                if let Some(result) = v.get("result") {
                    if let Some(a) = result.get("focusActive").and_then(Value::as_bool) {
                        *active = a;
                        changed = true;
                    }
                    if let Some(e) =
                        result.pointer("/settings/trayIconEnabled").and_then(Value::as_bool)
                    {
                        *enabled = e;
                        changed = true;
                    }
                }
            }
            Some("event") => match v.get("event").and_then(|e| e.as_str()) {
                Some("focusChanged") => {
                    if let Some(a) = v.pointer("/payload/active").and_then(Value::as_bool) {
                        *active = a;
                        changed = true;
                    }
                }
                Some("settingsChanged") => {
                    if let Some(e) = v
                        .pointer("/payload/settings/trayIconEnabled")
                        .and_then(Value::as_bool)
                    {
                        *enabled = e;
                        changed = true;
                    }
                }
                _ => {}
            },
            _ => {}
        }

        if changed {
            sync_tray(handle, *enabled, *active, icon_green, icon_gray).await;
        }
    }
    Ok(())
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    tracing_subscriber::fmt().with_env_filter("info").init();

    let icon_green = load_icon(include_bytes!(
        "../../../../apps/desktop/resources/tray-green.png"
    ));
    let icon_gray = load_icon(include_bytes!(
        "../../../../apps/desktop/resources/tray-gray.png"
    ));

    let mut handle: Option<ksni::Handle<TalysmanTray>> = None;
    // Optimistic defaults (mirrors DEFAULT_SETTINGS / ServiceState in packages/shared) until the
    // first getState response lands — kept off until then rather than flashing a guess.
    let mut enabled = false;
    let mut active = false;

    loop {
        if let Err(e) = pump_socket(&mut handle, &mut enabled, &mut active, &icon_green, &icon_gray).await
        {
            tracing::debug!("[tray] socket error, reconnecting: {e}");
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}
