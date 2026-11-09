use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Runtime};

use crate::click_through::PET_WINDOW;
use crate::window_state::{self, PositionSaver};

const MENU_TOGGLE: &str = "toggle";
const MENU_RESET: &str = "reset-position";
const MENU_QUIT: &str = "quit";

pub fn create<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, MENU_TOGGLE, "显示 / 隐藏桌宠", true, None::<&str>)?;
    let reset = MenuItem::with_id(app, MENU_RESET, "重置位置", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "退出", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&toggle, &reset, &PredefinedMenuItem::separator(app)?, &quit],
    )?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("记忆桌宠")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_TOGGLE => toggle_pet(app),
            MENU_RESET => {
                if let Some(window) = app.get_webview_window(PET_WINDOW) {
                    window_state::reset(&window);
                }
            }
            MENU_QUIT => {
                app.state::<PositionSaver>().flush_now(app);
                app.exit(0);
            }
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn toggle_pet<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(PET_WINDOW) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.show();
    }
}
