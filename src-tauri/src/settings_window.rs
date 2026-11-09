//! The settings window: a regular decorated window created on demand.

use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

pub const SETTINGS_WINDOW: &str = "settings";

pub fn open<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW) {
        window.unminimize()?;
        window.show()?;
        return window.set_focus();
    }
    // The frontend picks the page by window label, so the same entry is reused.
    WebviewWindowBuilder::new(app, SETTINGS_WINDOW, WebviewUrl::App("index.html".into()))
        .title("记忆桌宠 · 设置")
        .inner_size(520.0, 640.0)
        .min_inner_size(440.0, 520.0)
        .center()
        .build()?;
    Ok(())
}

/// Async so window creation does not run on the main thread (deadlocks on Windows).
#[tauri::command]
pub async fn open_settings_window(app: AppHandle) -> Result<(), String> {
    open(&app).map_err(|err| err.to_string())
}
