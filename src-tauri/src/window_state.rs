//! Persists the pet window position across restarts.
//!
//! Positions are stored in physical pixels in desktop coordinates. On restore we
//! check that the window would still land on a connected monitor; otherwise we
//! fall back to the bottom-right corner of the primary monitor.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, PhysicalPosition, Runtime, WebviewWindow};

const STATE_FILE: &str = "window-state.json";
const SAVE_DEBOUNCE: Duration = Duration::from_millis(500);
const EDGE_MARGIN: i32 = 48;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct SavedPosition {
    pub x: i32,
    pub y: i32,
}

/// Debounces position writes while the user drags the window.
#[derive(Default)]
pub struct PositionSaver {
    pending: Mutex<Option<(SavedPosition, Instant)>>,
}

impl PositionSaver {
    pub fn record(&self, pos: PhysicalPosition<i32>) {
        let mut pending = self.pending.lock().unwrap();
        *pending = Some((SavedPosition { x: pos.x, y: pos.y }, Instant::now()));
    }

    /// Writes the pending position once it has been stable for `SAVE_DEBOUNCE`.
    pub fn flush_if_due<R: Runtime>(&self, app: &AppHandle<R>) {
        let due = {
            let mut pending = self.pending.lock().unwrap();
            match *pending {
                Some((pos, at)) if at.elapsed() >= SAVE_DEBOUNCE => pending.take().map(|_| pos),
                _ => None,
            }
        };
        if let Some(pos) = due {
            save(app, pos);
        }
    }

    pub fn flush_now<R: Runtime>(&self, app: &AppHandle<R>) {
        if let Some((pos, _)) = self.pending.lock().unwrap().take() {
            save(app, pos);
        }
    }
}

fn state_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(STATE_FILE))
}

fn load<R: Runtime>(app: &AppHandle<R>) -> Option<SavedPosition> {
    let raw = fs::read_to_string(state_path(app)?).ok()?;
    serde_json::from_str(&raw).ok()
}

fn save<R: Runtime>(app: &AppHandle<R>, pos: SavedPosition) {
    let Some(path) = state_path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string(&pos)
        && let Err(err) = fs::write(&path, json)
    {
        eprintln!("failed to save window state to {}: {err}", path.display());
    }
}

/// Moves the window to its saved position, or to the default corner when the
/// saved position is missing or no longer on any monitor.
pub fn restore<R: Runtime>(window: &WebviewWindow<R>) {
    let app = window.app_handle();
    let target = load(app)
        .filter(|pos| is_on_some_monitor(window, *pos))
        .or_else(|| default_position(window));
    if let Some(pos) = target {
        let _ = window.set_position(PhysicalPosition::new(pos.x, pos.y));
    }
}

pub fn reset<R: Runtime>(window: &WebviewWindow<R>) {
    if let Some(pos) = default_position(window) {
        let _ = window.set_position(PhysicalPosition::new(pos.x, pos.y));
        save(window.app_handle(), pos);
    }
}

fn is_on_some_monitor<R: Runtime>(window: &WebviewWindow<R>, pos: SavedPosition) -> bool {
    window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .any(|m| {
            let (width, height) = window_size(window, m.scale_factor());
            let center_x = pos.x + width / 2;
            let center_y = pos.y + height / 2;
            let p = m.position();
            let s = m.size();
            center_x >= p.x
                && center_x < p.x + s.width as i32
                && center_y >= p.y
                && center_y < p.y + s.height as i32
        })
}

fn default_position<R: Runtime>(window: &WebviewWindow<R>) -> Option<SavedPosition> {
    let monitor = window
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten())?;
    let (width, height) = window_size(window, monitor.scale_factor());
    let margin = (EDGE_MARGIN as f64 * monitor.scale_factor()) as i32;
    let m_pos = monitor.position();
    let m_size = monitor.size();
    Some(SavedPosition {
        x: m_pos.x + m_size.width as i32 - width - margin,
        y: m_pos.y + m_size.height as i32 - height - margin,
    })
}

/// Physical window size. Some platforms (e.g. GTK) report 0x0 until the window
/// is first shown, so fall back to the size declared in `tauri.conf.json`.
fn window_size<R: Runtime>(window: &WebviewWindow<R>, scale: f64) -> (i32, i32) {
    if let Ok(size) = window.outer_size()
        && size.width > 0
        && size.height > 0
    {
        return (size.width as i32, size.height as i32);
    }
    window
        .app_handle()
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == window.label())
        .map(|w| ((w.width * scale) as i32, (w.height * scale) as i32))
        .unwrap_or((0, 0))
}
