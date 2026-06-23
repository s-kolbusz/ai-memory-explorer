use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	tauri::Builder::default()
	.plugin(tauri_plugin_shell::init())
	.plugin(tauri_plugin_dialog::init())
		.setup(|app| {
			if cfg!(debug_assertions) {
				app.handle().plugin(
					tauri_plugin_log::Builder::default()
						.level(log::LevelFilter::Info)
						.build(),
				)?;
			}

			// Spawn the bundled Bun backend as a sidecar in release builds.
			// In dev, the beforeDevCommand already starts the backend on port 3333.
			if !cfg!(debug_assertions) {
				let sidecar = app
					.shell()
					.sidecar("server")
					.map_err(|e| {
						eprintln!("Failed to locate server sidecar: {}", e);
						e
					})?;

				let (mut rx, _child) = sidecar.spawn().map_err(|e| {
					eprintln!("Failed to spawn server sidecar: {}", e);
					e
				})?;

				tauri::async_runtime::spawn(async move {
					while let Some(event) = rx.recv().await {
						match event {
							CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
								println!("[server] {}", String::from_utf8_lossy(&line));
							}
							CommandEvent::Error(err) => {
								eprintln!("[server] error: {}", err);
							}
							CommandEvent::Terminated(payload) => {
								eprintln!("[server] terminated: {:?}", payload);
								break;
							}
							_ => {}
						}
					}
				});
			}

			Ok(())
		})
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}
