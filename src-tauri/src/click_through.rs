//! Per-pixel click-through for the transparent pet window.
//!
//! The OS can only make a whole window click-through (`set_ignore_cursor_events`),
//! and once it is, the webview receives no mouse events at all. So we poll the
//! global cursor position here, send it to the frontend while the cursor is over
//! the window, and the frontend replies via `set_cursor_hit` after sampling the
//! avatar's alpha channel / interactive DOM elements at that point.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewWindow};

use crate::window_state::PositionSaver;

pub const PET_WINDOW: &str = "pet";
pub const CURSOR_EVENT: &str = "pet://cursor";
pub const CURSOR_LEFT_EVENT: &str = "pet://cursor-left";
const POLL_INTERVAL: Duration = Duration::from_millis(33);

#[derive(Default)]
pub struct ClickThrough {
    /// Whether the window currently lets clicks pass through.
    ignoring: AtomicBool,
    last_sent: Mutex<Option<(i32, i32)>>,
}

impl ClickThrough {
    fn apply<R: Runtime>(&self, window: &WebviewWindow<R>, ignore: bool) {
        if self.ignoring.swap(ignore, Ordering::SeqCst) != ignore {
            let _ = window.set_ignore_cursor_events(ignore);
        }
    }
}

/// Cursor position in CSS pixels relative to the window's top-left corner.
#[derive(Clone, Copy, Serialize)]
struct CursorPayload {
    x: f64,
    y: f64,
}

#[tauri::command]
pub fn set_cursor_hit<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, ClickThrough>,
    hit: bool,
) {
    state.apply(&window, !hit);
}

pub fn start<R: Runtime>(app: AppHandle<R>) {
    thread::spawn(move || {
        loop {
            thread::sleep(POLL_INTERVAL);
            app.state::<PositionSaver>().flush_if_due(&app);
            let Some(window) = app.get_webview_window(PET_WINDOW) else {
                break;
            };
            if !window.is_visible().unwrap_or(false) {
                continue;
            }
            poll_once(&app, &window);
        }
    });
}

fn poll_once<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) {
    let state = app.state::<ClickThrough>();
    let (Ok(cursor), Ok(origin), Ok(size), Ok(scale)) = (
        window.cursor_position(),
        window.inner_position(),
        window.inner_size(),
        window.scale_factor(),
    ) else {
        return;
    };

    let local_x = cursor.x - origin.x as f64;
    let local_y = cursor.y - origin.y as f64;
    let inside = local_x >= 0.0
        && local_y >= 0.0
        && local_x < size.width as f64
        && local_y < size.height as f64;

    let mut last_sent = state.last_sent.lock().unwrap();
    if !inside {
        if last_sent.take().is_some() {
            let _ = window.emit_to(window.label(), CURSOR_LEFT_EVENT, ());
        }
        state.apply(window, true);
        return;
    }

    let key = (local_x.round() as i32, local_y.round() as i32);
    if *last_sent == Some(key) {
        return;
    }
    *last_sent = Some(key);
    drop(last_sent);

    let _ = window.emit_to(
        window.label(),
        CURSOR_EVENT,
        CursorPayload {
            x: local_x / scale,
            y: local_y / scale,
        },
    );
}
