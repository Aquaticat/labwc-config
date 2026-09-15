//! Resident launcher daemon.
//!
//! Keeps a Slint software-rendered list ready and maps it on a wlr-layer-shell surface when
//! a bare Meta tap is read from evdev or a `labwc-launcher` client connects to the socket.
//! Set `LABWC_LAUNCHER_TRACE=1` to print `READY`, `SHOW`, `ENTER`, `HIDE`, `TAP`, `FEEDBACK`, `WINDOW`,
//! and `FEEDBACK_END` with epoch milliseconds,
//! which the hot-path measurements use.

mod catalog;
mod daemon;
mod evdev;
mod feedback;
mod inotify;
mod server;
mod wayland;

use std::{
    cell::Cell,
    collections::HashSet,
    env, error, fmt,
    io::{self, Read},
    path::{Path, PathBuf},
    process::ExitCode,
    rc::Rc,
    sync::OnceLock,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use calloop::{
    EventLoop, Interest, LoopHandle, Mode, PostAction,
    generic::Generic,
    signals::{Signal, Signals},
    timer::{TimeoutAction, Timer},
};
use calloop_wayland_source::WaylandSource;
use launcher_core::{protocol::SOCKET_NAME, tap::TapRecognizer};
use slint::platform::{
    Platform, WindowAdapter,
    software_renderer::{MinimalSoftwareWindow, RepaintBufferType},
};
use smithay_client_toolkit::{
    compositor::CompositorState,
    output::OutputState,
    registry::RegistryState,
    seat::SeatState,
    shell::wlr_layer::LayerShell,
    shm::{Shm, slot::SlotPool},
};
use wayland_client::{Connection, globals::registry_queue_init};

use crate::daemon::{Daemon, Globals, HEIGHT, View, WIDTH, remove_if_present};

/// Types generated from `ui/launcher.slint`.
#[allow(
    clippy::missing_docs_in_private_items,
    reason = "slint-build generates these items without documentation"
)]
mod ui {
    slint::include_modules!();
}

use ui::{LauncherWindow, RowData};

/// Delay between the first application directory change and the rescan, so package installs rescan once.
const RELOAD_DELAY: Duration = Duration::from_millis(250);

/// Why the daemon could not start or keep running.
#[derive(Debug)]
pub enum DaemonError {
    /// `XDG_RUNTIME_DIR` is unset.
    NoRuntimeDir,
    /// Another daemon already answers on the socket.
    AlreadyRunning(PathBuf),
    /// A system call failed.
    Io {
        /// What the daemon was doing.
        context: &'static str,
        /// The underlying failure.
        source: io::Error,
    },
    /// Connecting to the compositor or binding a required global failed.
    Wayland(String),
    /// Slint could not set up the window.
    Slint(String),
    /// The event loop rejected a source or failed while dispatching.
    EventLoop(String),
}

impl fmt::Display for DaemonError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoRuntimeDir => write!(formatter, "XDG_RUNTIME_DIR is not set"),
            Self::AlreadyRunning(path) => write!(
                formatter,
                "another launcher daemon is serving {}",
                path.display()
            ),
            Self::Io { context, source } => write!(formatter, "{context}: {source}"),
            Self::Wayland(problem) => write!(formatter, "Wayland: {problem}"),
            Self::Slint(problem) => write!(formatter, "Slint: {problem}"),
            Self::EventLoop(problem) => write!(formatter, "event loop: {problem}"),
        }
    }
}

impl error::Error for DaemonError {
    fn source(&self) -> Option<&(dyn error::Error + 'static)> {
        match self {
            Self::Io { source, .. } => Some(source),
            _ => None,
        }
    }
}

/// Writes a diagnostic line to standard error, which the systemd journal records.
pub fn log(message: &str) {
    eprintln!("labwc-launcherd: {message}");
}

/// Prints a timing mark when `LABWC_LAUNCHER_TRACE` is set.
pub fn trace(mark: &str) {
    /// Whether tracing is enabled, read once.
    static ENABLED: OnceLock<bool> = OnceLock::new();
    if *ENABLED
        .get_or_init(|| env::var_os("LABWC_LAUNCHER_TRACE").is_some_and(|value| value == "1"))
    {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        eprintln!("{mark} {:.3}", now.as_secs_f64() * 1000.0);
    }
}

/// Slint platform backed by one software-rendered window the daemon draws by hand.
struct DaemonPlatform {
    /// The only window.
    window: Rc<MinimalSoftwareWindow>,
    /// Origin for Slint's animation clock.
    start: Instant,
}

impl Platform for DaemonPlatform {
    fn create_window_adapter(&self) -> Result<Rc<dyn WindowAdapter>, slint::PlatformError> {
        Ok(self.window.clone())
    }

    fn duration_since_start(&self) -> Duration {
        self.start.elapsed()
    }
}

/// Maps an event loop registration failure into a [`DaemonError`].
fn loop_error(error: impl fmt::Display) -> DaemonError {
    DaemonError::EventLoop(error.to_string())
}

/// Opens every readable keyboard or pointer not open yet and reads it from the event loop.
fn open_input_devices(handle: &LoopHandle<'static, Daemon>, open: &mut HashSet<PathBuf>) {
    let Ok(listing) = std::fs::read_dir(evdev::INPUT_DIR) else {
        log("cannot list /dev/input; the Meta tap is unavailable");
        return;
    };
    for entry in listing.flatten() {
        let path = entry.path();
        let is_event_device = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(evdev::is_event_device);
        if is_event_device && !open.contains(&path) {
            add_input_device(handle, open, path);
        }
    }
}

/// Opens one device node and registers it, logging permission problems once per node.
fn add_input_device(
    handle: &LoopHandle<'static, Daemon>,
    open: &mut HashSet<PathBuf>,
    path: PathBuf,
) {
    let device = match evdev::open_device(&path) {
        Ok(Some(device)) => device,
        Ok(None) => return,
        Err(error) => {
            log(&format!(
                "cannot read {}: {error}; is the user in the input group?",
                path.display()
            ));
            return;
        }
    };
    open.insert(path.clone());
    let source = Generic::new(device, Interest::READ, Mode::Level);
    let inserted = handle.insert_source(source, move |_, device, daemon: &mut Daemon| {
        let mut buffer = [0_u8; evdev::EVENT_SIZE * 64];
        loop {
            match (&**device).read(&mut buffer) {
                Ok(0) => return Ok(PostAction::Remove),
                Ok(length) => {
                    for event in evdev::key_events(&buffer[..length]) {
                        daemon.handle_key_event(event);
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    return Ok(PostAction::Continue);
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(_) => return Ok(PostAction::Remove),
            }
        }
    });
    if let Err(error) = inserted {
        log(&format!("watching {} failed: {error}", path.display()));
    }
}

/// Watches `/dev/input` for new devices and application directories for changed entries.
fn watch_changes(
    handle: &LoopHandle<'static, Daemon>,
    application_dirs: &[PathBuf],
) -> Result<(), DaemonError> {
    let watcher = inotify::create().map_err(|source| DaemonError::Io {
        context: "creating an inotify instance",
        source,
    })?;
    let input_watch = inotify::watch(
        &watcher,
        Path::new(evdev::INPUT_DIR),
        libc::IN_CREATE | libc::IN_ATTRIB,
    )
    .map_err(|source| DaemonError::Io {
        context: "watching /dev/input",
        source,
    })?;
    let application_mask = libc::IN_CREATE
        | libc::IN_DELETE
        | libc::IN_MODIFY
        | libc::IN_MOVED_FROM
        | libc::IN_MOVED_TO;
    for dir in application_dirs {
        // Missing directories are normal, for example an empty XDG_DATA_HOME.
        let _ = inotify::watch(&watcher, dir, application_mask);
    }
    let device_handle = handle.clone();
    let mut open_devices = HashSet::new();
    open_input_devices(handle, &mut open_devices);
    handle
        .insert_source(
            Generic::new(watcher, Interest::READ, Mode::Level),
            move |_, watcher, daemon| {
                let changes = match inotify::read_changes(watcher) {
                    Ok(changes) => changes,
                    Err(error) => {
                        log(&format!("reading inotify changes failed: {error}"));
                        return Ok(PostAction::Continue);
                    }
                };
                let mut applications_changed = false;
                for change in changes {
                    if change.watch != input_watch {
                        applications_changed = true;
                        continue;
                    }
                    let Some(name) = change.name.as_ref().and_then(|name| name.to_str()) else {
                        continue;
                    };
                    let path = Path::new(evdev::INPUT_DIR).join(name);
                    if evdev::is_event_device(name)
                        && !open_devices.contains(&path)
                        && path.exists()
                    {
                        add_input_device(&device_handle, &mut open_devices, path);
                    }
                }
                // Devices removed since the last scan are forgotten so a replugged device reopens.
                open_devices.retain(|path| path.exists());
                if applications_changed && !daemon.reload_pending {
                    daemon.reload_pending = true;
                    let scheduled = device_handle.insert_source(
                        Timer::from_duration(RELOAD_DELAY),
                        |_, (), daemon| {
                            daemon.reload_catalog();
                            TimeoutAction::Drop
                        },
                    );
                    if let Err(error) = scheduled {
                        log(&format!("scheduling a catalog reload failed: {error}"));
                        daemon.reload_pending = false;
                    }
                }
                Ok(PostAction::Continue)
            },
        )
        .map_err(loop_error)?;
    Ok(())
}

/// Starts the daemon and runs its event loop until SIGTERM or SIGINT.
fn run() -> Result<(), DaemonError> {
    // Block signals before any thread exists so every later thread inherits the mask.
    let signals =
        Signals::new(&[Signal::SIGCHLD, Signal::SIGTERM, Signal::SIGINT]).map_err(loop_error)?;
    let runtime_dir = env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .ok_or(DaemonError::NoRuntimeDir)?;
    let socket_path = runtime_dir.join(SOCKET_NAME);
    let listener = server::bind(&socket_path)?;

    let window = MinimalSoftwareWindow::new(RepaintBufferType::NewBuffer);
    slint::platform::set_platform(Box::new(DaemonPlatform {
        window: window.clone(),
        start: Instant::now(),
    }))
    .map_err(|error| DaemonError::Slint(error.to_string()))?;
    let ui = LauncherWindow::new().map_err(|error| DaemonError::Slint(error.to_string()))?;
    let clicked_row = Rc::new(Cell::new(None));
    ui.on_row_clicked({
        let clicked_row = clicked_row.clone();
        move |row| clicked_row.set(usize::try_from(row).ok())
    });
    window.set_size(slint::PhysicalSize::new(WIDTH, HEIGHT));
    slint::ComponentHandle::show(&ui).map_err(|error| DaemonError::Slint(error.to_string()))?;

    let connection =
        Connection::connect_to_env().map_err(|error| DaemonError::Wayland(error.to_string()))?;
    let (globals, event_queue) = registry_queue_init(&connection)
        .map_err(|error| DaemonError::Wayland(error.to_string()))?;
    let queue = event_queue.handle();
    let wayland_error = |error: &dyn fmt::Display| DaemonError::Wayland(error.to_string());
    let compositor =
        CompositorState::bind(&globals, &queue).map_err(|error| wayland_error(&error))?;
    let layer_shell = LayerShell::bind(&globals, &queue).map_err(|error| wayland_error(&error))?;
    let shm = Shm::bind(&globals, &queue).map_err(|error| wayland_error(&error))?;
    let registry = RegistryState::new(&globals);
    let seat = SeatState::new(&globals, &queue);
    let output = OutputState::new(&globals, &queue);
    let pool = SlotPool::new((WIDTH * HEIGHT * 4) as usize, &shm)
        .map_err(|error| wayland_error(&error))?;

    let mut event_loop: EventLoop<Daemon> = EventLoop::try_new().map_err(loop_error)?;
    let handle = event_loop.handle();
    let application_dirs = catalog::application_dirs();
    let desktops = catalog::current_desktops();
    let name_keys = catalog::session_name_keys();
    let guard_flag = runtime_dir.join("labwc-launcher-shortcuts-suspended");
    let mut daemon = Daemon {
        globals: Globals {
            registry,
            seat,
            output,
            compositor,
            layer_shell,
            shm,
            list: globals,
        },
        connection: connection.clone(),
        queue,
        loop_handle: handle.clone(),
        pool,
        keyboard: None,
        pointer: None,
        modifiers: smithay_client_toolkit::seat::keyboard::Modifiers::default(),
        layer: None,
        configured: false,
        scale: 1,
        rendered_scale: 1,
        window,
        ui,
        clicked_row,
        pixels: Vec::new(),
        view: View::Hidden,
        entries: catalog::load(&application_dirs, &desktops, &name_keys),
        recognizer: TapRecognizer::new(guard_flag.exists()),
        application_dirs,
        desktops,
        name_keys,
        feedback: None,
        reload_pending: false,
        guard_flag,
        children: Vec::new(),
    };

    WaylandSource::new(connection, event_queue)
        .insert(handle.clone())
        .map_err(loop_error)?;
    server::serve(&handle, listener)?;
    watch_changes(&handle, &daemon.application_dirs.clone())?;
    let stop = event_loop.get_signal();
    handle
        .insert_source(signals, move |event, (), daemon| {
            if event.signal() == Signal::SIGCHLD {
                daemon.reap_children();
                return;
            }
            stop.stop();
        })
        .map_err(loop_error)?;

    trace("READY");
    let result = event_loop
        .run(None, &mut daemon, |_| {})
        .map_err(loop_error);
    daemon.hide();
    // A clean stop means the graphical session ended, and labwc's own shortcut state resets with it.
    let _ = remove_if_present(&daemon.guard_flag);
    let _ = remove_if_present(&socket_path);
    result
}

/// Runs the daemon, reporting startup failures on standard error.
fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            log(&error.to_string());
            ExitCode::FAILURE
        }
    }
}
