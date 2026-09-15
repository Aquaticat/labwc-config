//! PROTOTYPE: resident Slint launcher on a wlr-layer-shell surface.
//! SIGUSR1 toggles the surface; keyboard focus time is printed as epoch milliseconds.

use std::{
    rc::Rc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use calloop::{
    EventLoop,
    signals::{Signal, Signals},
};
use calloop_wayland_source::WaylandSource;
use slint::platform::{
    Platform, WindowAdapter,
    software_renderer::{MinimalSoftwareWindow, PremultipliedRgbaColor, RepaintBufferType},
};
use smithay_client_toolkit::{
    compositor::{CompositorHandler, CompositorState},
    delegate_registry,
    output::{OutputHandler, OutputState},
    registry::{ProvidesRegistryState, RegistryState},
    registry_handlers,
    seat::{
        Capability, SeatHandler, SeatState,
        keyboard::{KeyEvent, KeyboardHandler, Keysym, Modifiers, RawModifiers},
    },
    shell::{
        WaylandSurface,
        wlr_layer::{
            Anchor, KeyboardInteractivity, Layer, LayerShell, LayerShellHandler, LayerSurface,
            LayerSurfaceConfigure,
        },
    },
    shm::{Shm, ShmHandler, slot::SlotPool},
};
use wayland_client::{
    Connection, QueueHandle,
    globals::registry_queue_init,
    protocol::{wl_keyboard, wl_output, wl_seat, wl_shm, wl_surface},
};

slint::slint! {
    import "/usr/share/fonts/TTF/DejaVuSans.ttf";
    export component Launcher inherits Window {
        background: black;
        default-font-family: "DejaVu Sans";
        VerticalLayout {
            padding: 12px;
            spacing: 6px;
            Text { text: "Search: fire"; color: #d8d8d8; font-size: 16px; }
            for name in ["Firefox", "Files", "Foot", "Fuzzel", "Font Viewer", "Fcitx", "FreeCAD", "Fastfetch", "Flatseal", "Firewall"] : Text {
                text: name;
                color: #a8a8a8;
                font-size: 14px;
            }
        }
    }
}

const WIDTH: u32 = 480;
const HEIGHT: u32 = 360;

struct SpikePlatform {
    window: Rc<MinimalSoftwareWindow>,
    start: Instant,
}

impl Platform for SpikePlatform {
    fn create_window_adapter(&self) -> Result<Rc<dyn WindowAdapter>, slint::PlatformError> {
        Ok(self.window.clone())
    }
    fn duration_since_start(&self) -> Duration {
        self.start.elapsed()
    }
}

fn epoch_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs_f64() * 1000.0
}

struct App {
    registry_state: RegistryState,
    seat_state: SeatState,
    output_state: OutputState,
    compositor: CompositorState,
    layer_shell: LayerShell,
    shm: Shm,
    pool: SlotPool,
    layer: Option<LayerSurface>,
    keyboard: Option<wl_keyboard::WlKeyboard>,
    window: Rc<MinimalSoftwareWindow>,
    pixels: Vec<PremultipliedRgbaColor>,
    _ui: Launcher,
}

impl App {
    fn toggle(&mut self, qh: &QueueHandle<Self>) {
        if self.layer.take().is_some() {
            eprintln!("HIDE {:.3}", epoch_ms());
            return;
        }
        eprintln!("SHOW {:.3}", epoch_ms());
        // PROTOTYPE positive control: SPIKE_DELAY_MS adds a known delay to the measured chain.
        if let Some(delay) = std::env::var("SPIKE_DELAY_MS").ok().and_then(|value| value.parse().ok()) {
            std::thread::sleep(Duration::from_millis(delay));
        }
        let surface = self.compositor.create_surface(qh);
        let layer =
            self.layer_shell.create_layer_surface(qh, surface, Layer::Overlay, Some("spike"), None);
        layer.set_anchor(Anchor::BOTTOM | Anchor::LEFT);
        layer.set_keyboard_interactivity(KeyboardInteractivity::OnDemand);
        layer.set_size(WIDTH, HEIGHT);
        layer.commit();
        self.layer = Some(layer);
    }

    fn draw(&mut self) {
        let Some(layer) = self.layer.as_ref() else { return };
        slint::platform::update_timers_and_animations();
        self.window.request_redraw();
        let pixels = &mut self.pixels;
        self.window.draw_if_needed(|renderer| {
            renderer.render(pixels, WIDTH as usize);
        });
        let (buffer, canvas) = self
            .pool
            .create_buffer(WIDTH as i32, HEIGHT as i32, WIDTH as i32 * 4, wl_shm::Format::Argb8888)
            .expect("create buffer");
        for (chunk, pixel) in canvas.chunks_exact_mut(4).zip(pixels.iter()) {
            chunk.copy_from_slice(&[pixel.blue, pixel.green, pixel.red, pixel.alpha]);
        }
        layer.wl_surface().damage_buffer(0, 0, WIDTH as i32, HEIGHT as i32);
        buffer.attach_to(layer.wl_surface()).expect("attach");
        layer.commit();
    }
}

impl CompositorHandler for App {
    fn scale_factor_changed(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        _: &wl_surface::WlSurface,
        _: i32,
    ) {
    }
    fn transform_changed(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        _: &wl_surface::WlSurface,
        _: wl_output::Transform,
    ) {
    }
    fn frame(&mut self, _: &Connection, _: &QueueHandle<Self>, _: &wl_surface::WlSurface, _: u32) {}
    fn surface_enter(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        _: &wl_surface::WlSurface,
        _: &wl_output::WlOutput,
    ) {
    }
    fn surface_leave(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        _: &wl_surface::WlSurface,
        _: &wl_output::WlOutput,
    ) {
    }
}

impl OutputHandler for App {
    fn output_state(&mut self) -> &mut OutputState {
        &mut self.output_state
    }
    fn new_output(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_output::WlOutput) {}
    fn update_output(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_output::WlOutput) {}
    fn output_destroyed(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_output::WlOutput) {}
}

impl LayerShellHandler for App {
    fn closed(&mut self, _: &Connection, _: &QueueHandle<Self>, _: &LayerSurface) {
        self.layer = None;
    }
    fn configure(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        _: &LayerSurface,
        _: LayerSurfaceConfigure,
        _: u32,
    ) {
        self.draw();
    }
}

impl SeatHandler for App {
    fn seat_state(&mut self) -> &mut SeatState {
        &mut self.seat_state
    }
    fn new_seat(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_seat::WlSeat) {}
    fn new_capability(
        &mut self,
        _: &Connection,
        qh: &QueueHandle<Self>,
        seat: wl_seat::WlSeat,
        capability: Capability,
    ) {
        if capability == Capability::Keyboard && self.keyboard.is_none() {
            self.keyboard = Some(self.seat_state.get_keyboard(qh, &seat, None).expect("keyboard"));
        }
    }
    fn remove_capability(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        _: wl_seat::WlSeat,
        _: Capability,
    ) {
    }
    fn remove_seat(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_seat::WlSeat) {}
}

impl KeyboardHandler for App {
    fn enter(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        _: &wl_keyboard::WlKeyboard,
        _: &wl_surface::WlSurface,
        _: u32,
        _: &[u32],
        _: &[Keysym],
    ) {
        eprintln!("ENTER {:.3}", epoch_ms());
    }
    fn leave(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        _: &wl_keyboard::WlKeyboard,
        _: &wl_surface::WlSurface,
        _: u32,
    ) {
        eprintln!("LEAVE {:.3}", epoch_ms());
    }
    fn press_key(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        _: &wl_keyboard::WlKeyboard,
        _: u32,
        _: KeyEvent,
    ) {
    }
    fn repeat_key(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        _: &wl_keyboard::WlKeyboard,
        _: u32,
        _: KeyEvent,
    ) {
    }
    fn release_key(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        _: &wl_keyboard::WlKeyboard,
        _: u32,
        _: KeyEvent,
    ) {
    }
    fn update_modifiers(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        _: &wl_keyboard::WlKeyboard,
        _: u32,
        _: Modifiers,
        _: RawModifiers,
        _: u32,
    ) {
    }
}

impl ShmHandler for App {
    fn shm_state(&mut self) -> &mut Shm {
        &mut self.shm
    }
}

impl ProvidesRegistryState for App {
    fn registry(&mut self) -> &mut RegistryState {
        &mut self.registry_state
    }
    registry_handlers![OutputState, SeatState];
}

delegate_registry!(App);
smithay_client_toolkit::delegate_dispatch2!(App);

fn main() {
    // Block SIGUSR1 before any thread exists so every later thread inherits the mask.
    let signals = Signals::new(&[Signal::SIGUSR1]).unwrap();
    let window = MinimalSoftwareWindow::new(RepaintBufferType::NewBuffer);
    slint::platform::set_platform(Box::new(SpikePlatform {
        window: window.clone(),
        start: Instant::now(),
    }))
    .unwrap();
    let ui = Launcher::new().unwrap();
    window.set_size(slint::PhysicalSize::new(WIDTH, HEIGHT));
    ui.show().unwrap();

    let conn = Connection::connect_to_env().unwrap();
    let (globals, event_queue) = registry_queue_init(&conn).unwrap();
    let qh = event_queue.handle();
    let compositor = CompositorState::bind(&globals, &qh).unwrap();
    let layer_shell = LayerShell::bind(&globals, &qh).unwrap();
    let shm = Shm::bind(&globals, &qh).unwrap();
    let pool = SlotPool::new((WIDTH * HEIGHT * 4) as usize, &shm).unwrap();
    let mut app = App {
        registry_state: RegistryState::new(&globals),
        seat_state: SeatState::new(&globals, &qh),
        output_state: OutputState::new(&globals, &qh),
        compositor,
        layer_shell,
        shm,
        pool,
        layer: None,
        keyboard: None,
        window,
        pixels: vec![PremultipliedRgbaColor::default(); (WIDTH * HEIGHT) as usize],
        _ui: ui,
    };

    let mut event_loop: EventLoop<App> = EventLoop::try_new().unwrap();
    WaylandSource::new(conn, event_queue).insert(event_loop.handle()).unwrap();
    event_loop.handle().insert_source(signals, move |_, _, app| app.toggle(&qh)).unwrap();
    eprintln!("READY {:.3}", epoch_ms());
    loop {
        event_loop.dispatch(None, &mut app).unwrap();
    }
}
