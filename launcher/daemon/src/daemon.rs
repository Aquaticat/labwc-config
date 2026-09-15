//! Daemon state and the actions requests, keys, and taps trigger.

use std::{
    cell::Cell,
    fs,
    os::unix::net::UnixStream,
    path::PathBuf,
    process::{Child, Command, Stdio},
    rc::Rc,
};

use calloop::LoopHandle;
use launcher_core::{
    desktop_entry::DesktopEntry,
    protocol::{Reply, Request, decode_request},
    rank::Order,
    session::{Outcome, Session},
    tap::{Action, KeyEvent, TapRecognizer},
};
use slint::{
    ModelRc, PhysicalSize, SharedString, VecModel,
    platform::{
        WindowAdapter, WindowEvent,
        software_renderer::{MinimalSoftwareWindow, PremultipliedRgbaColor},
    },
};
use smithay_client_toolkit::{
    compositor::CompositorState,
    output::OutputState,
    registry::RegistryState,
    seat::{SeatState, keyboard::Modifiers},
    shell::{
        WaylandSurface,
        wlr_layer::{Anchor, KeyboardInteractivity, Layer, LayerShell, LayerSurface},
    },
    shm::{Shm, slot::SlotPool},
};
use wayland_client::{
    QueueHandle,
    protocol::{wl_keyboard::WlKeyboard, wl_pointer::WlPointer, wl_shm},
};

use crate::{LauncherWindow, RowData, catalog, log, server::send_reply, trace};

/// Launcher width in logical pixels.
pub const WIDTH: u32 = 480;
/// Launcher height in logical pixels: padding, the query line, and [`VISIBLE_ROWS`] rows.
pub const HEIGHT: u32 = 8 + 40 + VISIBLE_ROWS as u32 * 28 + 8;
/// Rows that fit below the query line.
pub const VISIBLE_ROWS: usize = 11;

/// What the launcher currently shows.
#[derive(Debug, Default)]
pub enum View {
    /// Nothing.
    #[default]
    Hidden,
    /// The application list.
    Apps {
        /// Query and selection.
        session: Session,
        /// Entries as they were when the launcher opened, indexed like the session's choices.
        entries: Vec<DesktopEntry>,
    },
    /// A dmenu request.
    Dmenu {
        /// Query and selection.
        session: Session,
        /// Prompt from the client.
        prompt: String,
        /// Lines from the client, indexed like the session's choices.
        lines: Vec<String>,
        /// Connection that receives the choice.
        reply: UnixStream,
    },
}

impl View {
    /// The session of a shown view.
    pub fn session_mut(&mut self) -> Option<&mut Session> {
        match self {
            Self::Hidden => None,
            Self::Apps { session, .. } | Self::Dmenu { session, .. } => Some(session),
        }
    }
}

/// Wayland protocol objects the daemon binds once.
pub struct Globals {
    /// Registry bookkeeping for sctk.
    pub registry: RegistryState,
    /// Seats and their input devices.
    pub seat: SeatState,
    /// Outputs and their scale factors.
    pub output: OutputState,
    /// Surface creation.
    pub compositor: CompositorState,
    /// Layer surface creation.
    pub layer_shell: LayerShell,
    /// Shared-memory buffers.
    pub shm: Shm,
}

/// Everything the event loop callbacks mutate.
pub struct Daemon {
    /// Bound Wayland globals.
    pub globals: Globals,
    /// Queue handle for creating Wayland objects.
    pub queue: QueueHandle<Self>,
    /// Event loop handle for registering sources.
    pub loop_handle: LoopHandle<'static, Self>,
    /// Buffers handed to the compositor.
    pub pool: SlotPool,
    /// The seat keyboard, once announced.
    pub keyboard: Option<WlKeyboard>,
    /// The seat pointer, once announced.
    pub pointer: Option<WlPointer>,
    /// Modifier state for deciding whether a key press is text.
    pub modifiers: Modifiers,
    /// The layer surface while the launcher is shown.
    pub layer: Option<LayerSurface>,
    /// Whether the compositor has configured the current layer surface.
    pub configured: bool,
    /// Integer buffer scale to render at.
    pub scale: u32,
    /// Scale the Slint window was last told about.
    pub rendered_scale: u32,
    /// Slint's view of the window.
    pub window: Rc<MinimalSoftwareWindow>,
    /// The compiled interface.
    pub ui: LauncherWindow,
    /// Row index set by the interface's click callback and consumed after pointer dispatch.
    pub clicked_row: Rc<Cell<Option<usize>>>,
    /// Rendered pixels before conversion to the Wayland buffer format.
    pub pixels: Vec<PremultipliedRgbaColor>,
    /// What is shown.
    pub view: View,
    /// Applications to list, refreshed when application directories change.
    pub entries: Vec<DesktopEntry>,
    /// Directories scanned for desktop entries.
    pub application_dirs: Vec<PathBuf>,
    /// Desktop names from `XDG_CURRENT_DESKTOP`.
    pub desktops: Vec<String>,
    /// Whether a catalog reload is already scheduled.
    pub reload_pending: bool,
    /// Meta tap and shortcut guard recognition.
    pub recognizer: TapRecognizer,
    /// File whose presence records that global shortcuts are suspended.
    pub guard_flag: PathBuf,
    /// Launched processes not yet reaped.
    pub children: Vec<Child>,
}

impl Daemon {
    /// Handles one decoded client request.
    pub fn handle_request(&mut self, bytes: &[u8], reply: UnixStream) {
        // An empty connection is a liveness probe, such as a second daemon checking the socket.
        if bytes.is_empty() {
            return;
        }
        let request = match decode_request(bytes) {
            Ok(request) => request,
            Err(error) => {
                log(&format!("ignoring an invalid request: {error:?}"));
                return;
            }
        };
        match request {
            Request::Toggle => self.toggle(),
            Request::Close => self.hide(),
            Request::Dmenu { prompt, lines } => {
                self.cancel_dmenu();
                let session = Session::new(lines.clone(), Order::Given, VISIBLE_ROWS);
                self.show(View::Dmenu {
                    session,
                    prompt,
                    lines,
                    reply,
                });
            }
        }
    }

    /// Shows the application list, or hides whatever is shown.
    pub fn toggle(&mut self) {
        if self.layer.is_some() {
            self.hide();
            return;
        }
        let entries = self.entries.clone();
        let names = entries.iter().map(|entry| entry.name.clone()).collect();
        let session = Session::new(names, Order::Alphabetical, VISIBLE_ROWS);
        self.show(View::Apps { session, entries });
    }

    /// Replaces the view and maps the layer surface when it is not mapped yet.
    fn show(&mut self, view: View) {
        trace("SHOW");
        self.view = view;
        if self.layer.is_some() {
            self.draw();
            return;
        }
        let surface = self.globals.compositor.create_surface(&self.queue);
        let layer = self.globals.layer_shell.create_layer_surface(
            &self.queue,
            surface,
            Layer::Overlay,
            Some("labwc-launcher"),
            None,
        );
        layer.set_anchor(Anchor::BOTTOM | Anchor::LEFT);
        layer.set_keyboard_interactivity(KeyboardInteractivity::OnDemand);
        layer.set_size(WIDTH, HEIGHT);
        layer.commit();
        self.layer = Some(layer);
        self.configured = false;
    }

    /// Unmaps the launcher, cancelling a pending dmenu request.
    pub fn hide(&mut self) {
        self.cancel_dmenu();
        self.view = View::Hidden;
        if self.layer.take().is_some() {
            trace("HIDE");
        }
        self.configured = false;
    }

    /// Answers a shown dmenu request with a cancellation.
    fn cancel_dmenu(&mut self) {
        if let View::Dmenu { reply, .. } = std::mem::take(&mut self.view) {
            send_reply(reply, &Reply::Cancelled);
        }
    }

    /// Carries out what a key, click, or scroll step produced.
    pub fn apply(&mut self, outcome: Outcome) {
        match outcome {
            Outcome::Redraw => self.draw(),
            Outcome::Ignored => {}
            Outcome::Dismiss => self.hide(),
            Outcome::Activate(index) => self.activate(index),
        }
    }

    /// Launches the chosen application or answers the dmenu client, then hides.
    fn activate(&mut self, index: usize) {
        match std::mem::take(&mut self.view) {
            View::Apps { entries, .. } => {
                if let Some(entry) = entries.get(index) {
                    self.launch(&entry.argv);
                }
            }
            View::Dmenu { lines, reply, .. } => {
                let chosen = lines
                    .get(index)
                    .cloned()
                    .map_or(Reply::Cancelled, Reply::Selected);
                send_reply(reply, &chosen);
            }
            View::Hidden => {}
        }
        self.hide();
    }

    /// Starts `argv` as its own systemd user unit through UWSM.
    fn launch(&mut self, argv: &[String]) {
        let spawned = Command::new("uwsm")
            .args(["app", "-t", "service", "--"])
            .args(argv)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .spawn();
        match spawned {
            Ok(child) => self.children.push(child),
            Err(error) => log(&format!("launching {argv:?} failed: {error}")),
        }
    }

    /// Reaps launched processes that have exited.
    pub fn reap_children(&mut self) {
        self.children
            .retain_mut(|child| matches!(child.try_wait(), Ok(None)));
    }

    /// Feeds one evdev key event to the tap recognizer and acts on the result.
    pub fn handle_key_event(&mut self, event: KeyEvent) {
        match self.recognizer.feed(event) {
            Some(Action::Tap) => {
                trace("TAP");
                self.toggle();
            }
            Some(Action::GuardChanged { suspended }) => self.guard_changed(suspended),
            None => {}
        }
    }

    /// Records the shortcut guard state and tells the user.
    fn guard_changed(&mut self, suspended: bool) {
        let recorded = if suspended {
            fs::write(&self.guard_flag, b"")
        } else {
            remove_if_present(&self.guard_flag)
        };
        if let Err(error) = recorded {
            log(&format!(
                "recording the shortcut guard at {} failed: {error}",
                self.guard_flag.display()
            ));
        }
        let (title, body) = if suspended {
            (
                "Shortcuts suspended",
                "Keys pass through (Meta+F12 to restore)",
            )
        } else {
            ("Shortcuts restored", "Global shortcuts active again")
        };
        let notified = Command::new("notify-send")
            .args(["--expire-time=2000", title, body])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .spawn();
        match notified {
            Ok(child) => self.children.push(child),
            Err(error) => log(&format!(
                "notifying about the shortcut guard failed: {error}"
            )),
        }
    }

    /// Rescans application directories.
    pub fn reload_catalog(&mut self) {
        self.reload_pending = false;
        self.entries = catalog::load(&self.application_dirs, &self.desktops);
    }

    /// Picks the scale for a new surface before the compositor reports one: the largest output scale.
    pub fn initial_scale(&self) -> u32 {
        self.globals
            .output
            .outputs()
            .filter_map(|output| self.globals.output.info(&output))
            .filter_map(|info| u32::try_from(info.scale_factor).ok())
            .max()
            .unwrap_or(1)
            .max(1)
    }

    /// Renders the current view into a new buffer and commits it.
    pub fn draw(&mut self) {
        let Some(layer) = self.layer.as_ref().filter(|_| self.configured) else {
            return;
        };
        let rows: Vec<RowData> = match &self.view {
            View::Hidden => return,
            View::Apps { session, .. } | View::Dmenu { session, .. } => {
                self.ui.set_query(session.query().into());
                session
                    .rows()
                    .into_iter()
                    .map(|row| RowData {
                        text: SharedString::from(row.text),
                        selected: row.selected,
                    })
                    .collect()
            }
        };
        let prompt = if let View::Dmenu { prompt, .. } = &self.view {
            prompt.as_str()
        } else {
            ""
        };
        self.ui.set_prompt(prompt.into());
        self.ui.set_rows(ModelRc::new(VecModel::from(rows)));

        let scale = self.scale.max(1);
        if scale != self.rendered_scale {
            #[expect(
                clippy::cast_precision_loss,
                reason = "output scales are small integers"
            )]
            let scale_factor = scale as f32;
            self.window
                .window()
                .dispatch_event(WindowEvent::ScaleFactorChanged { scale_factor });
            self.rendered_scale = scale;
        }
        let (width, height) = (WIDTH * scale, HEIGHT * scale);
        self.window.set_size(PhysicalSize::new(width, height));
        self.pixels
            .resize((width * height) as usize, PremultipliedRgbaColor::default());
        slint::platform::update_timers_and_animations();
        self.window.request_redraw();
        let pixels = &mut self.pixels;
        self.window.draw_if_needed(|renderer| {
            renderer.render(pixels, width as usize);
        });

        let (Ok(buffer_width), Ok(buffer_height)) = (i32::try_from(width), i32::try_from(height))
        else {
            return;
        };
        let (buffer, canvas) = match self.pool.create_buffer(
            buffer_width,
            buffer_height,
            buffer_width * 4,
            wl_shm::Format::Argb8888,
        ) {
            Ok(created) => created,
            Err(error) => {
                log(&format!(
                    "allocating a {width}x{height} buffer failed: {error}"
                ));
                return;
            }
        };
        for (bytes, pixel) in canvas.as_chunks_mut::<4>().0.iter_mut().zip(&self.pixels) {
            *bytes = [pixel.blue, pixel.green, pixel.red, pixel.alpha];
        }
        let surface = layer.wl_surface();
        surface.set_buffer_scale(scale.cast_signed());
        surface.damage_buffer(0, 0, buffer_width, buffer_height);
        if let Err(error) = buffer.attach_to(surface) {
            log(&format!("attaching the launcher buffer failed: {error}"));
            return;
        }
        layer.commit();
    }
}

/// Removes `path`, treating an already missing file as success.
pub fn remove_if_present(path: &std::path::Path) -> std::io::Result<()> {
    match fs::remove_file(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}
