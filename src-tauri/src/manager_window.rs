//! Character management window: import, consent, persona editing.

use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

pub const MANAGER_WINDOW: &str = "manager";

pub fn open<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MANAGER_WINDOW) {
        window.unminimize()?;
        window.show()?;
        return window.set_focus();
    }
    WebviewWindowBuilder::new(app, MANAGER_WINDOW, WebviewUrl::App("index.html".into()))
        .title("记忆桌宠 · 角色管理")
        .inner_size(640.0, 720.0)
        .min_inner_size(520.0, 560.0)
        .center()
        .build()?;
    Ok(())
}

#[tauri::command]
pub async fn open_manager_window(app: AppHandle) -> Result<(), String> {
    open(&app).map_err(|err| err.to_string())
}
