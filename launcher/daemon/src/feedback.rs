//! Launch feedback: a small non-interactive surface that says an application is starting.
//!
//! It replaces the earlier busy-cursor flip, which needed a labwc reconfigure that stalled the compositor for
//! about 14 ms in the VM on every flip.
//! The surface ends when the compositor announces a toplevel created after the launch, or after a timeout.

use std::time::{Duration, Instant};

use calloop::{
    RegistrationToken,
    timer::{TimeoutAction, Timer},
};
use smithay_client_toolkit::{
    compositor::Region,
    shell::{
        WaylandSurface,
        wlr_layer::{Anchor, KeyboardInteractivity, Layer, LayerSurface},
    },
};
use wayland_client::{
    Connection, Dispatch, Proxy, QueueHandle, event_created_child,
    protocol::wl_callback::{self, WlCallback},
};
use wayland_protocols::ext::foreign_toplevel_list::v1::client::{
    ext_foreign_toplevel_handle_v1::{self, ExtForeignToplevelHandleV1},
    ext_foreign_toplevel_list_v1::{self, ExtForeignToplevelListV1},
};

use crate::{daemon::Daemon, log, trace};

/// Feedback width in logical pixels.
pub const FEEDBACK_WIDTH: u32 = 300;
/// Feedback height in logical pixels.
pub const FEEDBACK_HEIGHT: u32 = 40;
/// Longest time feedback stays up when no window appears, matching KDE's busy cursor.
const TIMEOUT: Duration = Duration::from_secs(5);
/// Shortest time feedback stays up, so a fast application does not cause a subliminal blink.
const MINIMUM: Duration = Duration::from_millis(800);
/// Interval between spinner steps.
const STEP_INTERVAL: Duration = Duration::from_millis(83);
/// Number of spinner positions.
pub const SPINNER_STEPS: i32 = 8;

/// State of the shown feedback.
pub struct Feedback {
    /// The feedback layer surface.
    pub layer: LayerSurface,
    /// Whether the compositor has configured the surface.
    pub configured: bool,
    /// Text shown next to the spinner.
    pub label: String,
    /// Current spinner position.
    pub step: i32,
    /// When the latest launch started.
    pub started: Instant,
    /// Toplevel list bound for this feedback.
    pub toplevels: Option<ExtForeignToplevelListV1>,
    /// Whether the toplevels announced on bind have all arrived, so later ones are new windows.
    pub listening: bool,
    /// Whether a window appeared after the launch.
    pub window_appeared: bool,
    /// Whether the surface has been painted once, for the trace mark.
    pub painted: bool,
    /// Spinner timer, removed when feedback ends.
    pub timer: Option<RegistrationToken>,
}

/// Marks the sync callback that separates existing toplevels from new ones.
pub struct ExistingToplevelsDone;

impl Daemon {
    /// Shows or refreshes feedback for a launch labelled `label`.
    pub fn start_feedback(&mut self, label: String) {
        if let Some(feedback) = self.feedback.as_mut() {
            feedback.label = label;
            feedback.started = Instant::now();
            feedback.window_appeared = false;
            self.draw_feedback();
            return;
        }
        let surface = self.globals.compositor.create_surface(&self.queue);
        match Region::new(&self.globals.compositor) {
            // An empty input region lets clicks pass through to whatever is below.
            Ok(region) => surface.set_input_region(Some(region.wl_region())),
            Err(error) => log(&format!("creating an empty input region failed: {error}")),
        }
        let layer = self.globals.layer_shell.create_layer_surface(
            &self.queue,
            surface,
            Layer::Overlay,
            Some("labwc-launcher-feedback"),
            None,
        );
        layer.set_anchor(Anchor::BOTTOM | Anchor::LEFT);
        layer.set_keyboard_interactivity(KeyboardInteractivity::None);
        layer.set_size(FEEDBACK_WIDTH, FEEDBACK_HEIGHT);
        layer.commit();

        let toplevels = self
            .globals
            .list
            .bind::<ExtForeignToplevelListV1, _, _>(&self.queue, 1..=1, ())
            .map_err(|error| {
                log(&format!(
                    "binding ext_foreign_toplevel_list_v1 failed: {error}"
                ))
            })
            .ok();
        if toplevels.is_some() {
            self.connection
                .display()
                .sync(&self.queue, ExistingToplevelsDone);
        }
        self.feedback = Some(Feedback {
            layer,
            configured: false,
            label,
            step: 0,
            started: Instant::now(),
            toplevels,
            listening: false,
            window_appeared: false,
            painted: false,
            timer: None,
        });
        let ticking = self
            .loop_handle
            .insert_source(Timer::from_duration(STEP_INTERVAL), |_, (), daemon| {
                daemon.feedback_tick()
            });
        match ticking {
            Ok(token) => {
                if let Some(feedback) = self.feedback.as_mut() {
                    feedback.timer = Some(token);
                }
            }
            Err(error) => log(&format!("scheduling launch feedback failed: {error}")),
        }
    }

    /// Advances the spinner and ends feedback once a window appeared or the timeout passed.
    fn feedback_tick(&mut self) -> TimeoutAction {
        let Some(feedback) = self.feedback.as_mut() else {
            return TimeoutAction::Drop;
        };
        let elapsed = feedback.started.elapsed();
        if elapsed >= TIMEOUT || (feedback.window_appeared && elapsed >= MINIMUM) {
            self.end_feedback();
            return TimeoutAction::Drop;
        }
        feedback.step = (feedback.step + 1) % SPINNER_STEPS;
        self.draw_feedback();
        TimeoutAction::ToDuration(STEP_INTERVAL)
    }

    /// Removes the feedback surface and stops listening for toplevels.
    pub fn end_feedback(&mut self) {
        let Some(feedback) = self.feedback.take() else {
            return;
        };
        if let Some(toplevels) = feedback.toplevels {
            toplevels.stop();
        }
        if let Some(timer) = feedback.timer {
            self.loop_handle.remove(timer);
        }
        trace("FEEDBACK_END");
    }
}

impl Dispatch<ExtForeignToplevelListV1, ()> for Daemon {
    fn event(
        daemon: &mut Self,
        list: &ExtForeignToplevelListV1,
        event: ext_foreign_toplevel_list_v1::Event,
        (): &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        match event {
            ext_foreign_toplevel_list_v1::Event::Toplevel { toplevel } => {
                // Handles are only counted, never inspected.
                toplevel.destroy();
                if let Some(feedback) = daemon.feedback.as_mut()
                    && feedback.listening
                    && feedback
                        .toplevels
                        .as_ref()
                        .is_some_and(|bound| bound.id() == list.id())
                {
                    feedback.window_appeared = true;
                    trace("WINDOW");
                }
            }
            ext_foreign_toplevel_list_v1::Event::Finished => list.destroy(),
            _ => {}
        }
    }

    event_created_child!(Daemon, ExtForeignToplevelListV1, [
        ext_foreign_toplevel_list_v1::EVT_TOPLEVEL_OPCODE => (ExtForeignToplevelHandleV1, ())
    ]);
}

impl Dispatch<ExtForeignToplevelHandleV1, ()> for Daemon {
    fn event(
        _: &mut Self,
        _: &ExtForeignToplevelHandleV1,
        _: ext_foreign_toplevel_handle_v1::Event,
        (): &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

impl Dispatch<WlCallback, ExistingToplevelsDone> for Daemon {
    fn event(
        daemon: &mut Self,
        _: &WlCallback,
        event: wl_callback::Event,
        _: &ExistingToplevelsDone,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if matches!(event, wl_callback::Event::Done { .. })
            && let Some(feedback) = daemon.feedback.as_mut()
        {
            feedback.listening = true;
        }
    }
}
