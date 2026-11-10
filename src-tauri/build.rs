// Listing the app commands makes each one deny-by-default; capabilities/*.json grant them per window.
const COMMANDS: &[&str] = &[
    "set_cursor_hit",
    "open_settings_window",
    "open_manager_window",
    "vault_put",
    "vault_get",
    "vault_delete",
    "vault_list",
    "vault_wipe",
    "vault_status",
    "llm_get_settings",
    "llm_save_settings",
    "llm_set_key",
    "llm_clear_key",
    "llm_test",
    "llm_complete",
    "llm_stream",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
