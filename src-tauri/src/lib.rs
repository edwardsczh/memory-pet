mod click_through;
mod tray;
mod window_state;

use tauri::{Manager, WindowEvent};

use click_through::{ClickThrough, PET_WINDOW};
use window_state::PositionSaver;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ClickThrough::default())
        .manage(PositionSaver::default())
        .invoke_handler(tauri::generate_handler![click_through::set_cursor_hit])
        .setup(|app| {
            let window = app
                .get_webview_window(PET_WINDOW)
                .expect("pet window is declared in tauri.conf.json");
            window_state::restore(&window);
            window.show()?;

            let handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let WindowEvent::Moved(pos) = event {
                    handle.state::<PositionSaver>().record(*pos);
                }
            });

            tray::create(app.handle())?;
            click_through::start(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
