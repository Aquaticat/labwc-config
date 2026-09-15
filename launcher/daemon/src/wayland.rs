//! Wayland event handlers: layer surface lifecycle, scale, keyboard, and pointer input.

use launcher_core::session::Key;
use slint::{
    LogicalPosition,
    platform::{PointerEventButton, WindowAdapter, WindowEvent},
};
use smithay_client_toolkit::{
    compositor::CompositorHandler,
    delegate_registry,
    output::{OutputHandler, OutputState},
    registry::{ProvidesRegistryState, RegistryState},
    registry_handlers,
    seat::{
        Capability, SeatHandler, SeatState,
        keyboard::{KeyEvent, KeyboardHandler, Keysym, Modifiers, RawModifiers},
        pointer::{BTN_LEFT, PointerEvent, PointerEventKind, PointerHandler},
    },
    shell::{
        WaylandSurface,
        wlr_layer::{LayerShellHandler, LayerSurface, LayerSurfaceConfigure},
    },
    shm::{Shm, ShmHandler},
};
use wayland_client::{
    Connection, QueueHandle,
    protocol::{wl_keyboard, wl_output, wl_pointer, wl_seat, wl_surface},
};

use crate::{daemon::Daemon, log, trace};

impl Daemon {
    /// Whether `surface` is the current launch feedback surface.
    fn is_feedback_surface(&self, surface: &wl_surface::WlSurface) -> bool {
        self.feedback
            .as_ref()
            .is_some_and(|feedback| feedback.layer.wl_surface() == surface)
    }

    /// Whether `surface` is the launcher's current layer surface.
    fn is_launcher_surface(&self, surface: &wl_surface::WlSurface) -> bool {
        self.layer
            .as_ref()
            .is_some_and(|layer| layer.wl_surface() == surface)
    }

    /// Turns a pressed or repeated key into a session key and applies it.
    fn key_pressed(&mut self, event: KeyEvent) {
        let key = match event.keysym {
            Keysym::Escape => Key::Escape,
            Keysym::Return | Keysym::KP_Enter => Key::Enter,
            Keysym::BackSpace => Key::Backspace,
            Keysym::Up => Key::Up,
            Keysym::Down => Key::Down,
            _ if self.modifiers.ctrl || self.modifiers.alt || self.modifiers.logo => return,
            _ => match event.utf8 {
                Some(text) => Key::Text(text),
                None => return,
            },
        };
        if let Some(outcome) = self.view.session_mut().map(|session| session.handle(key)) {
            self.apply(outcome);
        }
    }
}

impl CompositorHandler for Daemon {
    fn scale_factor_changed(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        surface: &wl_surface::WlSurface,
        new_factor: i32,
    ) {
        let Ok(scale) = u32::try_from(new_factor) else {
            return;
        };
        if scale == self.scale {
            return;
        }
        if self.is_launcher_surface(surface) {
            self.scale = scale;
            self.draw();
        } else if self.is_feedback_surface(surface) {
            self.scale = scale;
            self.draw_feedback();
        }
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

impl OutputHandler for Daemon {
    fn output_state(&mut self) -> &mut OutputState {
        &mut self.globals.output
    }

    fn new_output(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_output::WlOutput) {}

    fn update_output(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_output::WlOutput) {}

    fn output_destroyed(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_output::WlOutput) {}
}

impl LayerShellHandler for Daemon {
    fn closed(&mut self, _: &Connection, _: &QueueHandle<Self>, layer: &LayerSurface) {
        if self.layer.as_ref() == Some(layer) {
            self.hide();
        } else if self
            .feedback
            .as_ref()
            .is_some_and(|feedback| &feedback.layer == layer)
        {
            self.end_feedback();
        }
    }

    fn configure(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        layer: &LayerSurface,
        _: LayerSurfaceConfigure,
        _: u32,
    ) {
        let feedback_first_configure = self
            .feedback
            .as_mut()
            .filter(|feedback| &feedback.layer == layer)
            .map(|feedback| !std::mem::replace(&mut feedback.configured, true));
        if let Some(first) = feedback_first_configure {
            if first {
                self.scale = self.initial_scale();
            }
            self.draw_feedback();
            return;
        }
        if self.layer.as_ref() != Some(layer) {
            return;
        }
        if !self.configured {
            self.configured = true;
            self.scale = self.initial_scale();
        }
        self.draw();
    }
}

impl SeatHandler for Daemon {
    fn seat_state(&mut self) -> &mut SeatState {
        &mut self.globals.seat
    }

    fn new_seat(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_seat::WlSeat) {}

    fn new_capability(
        &mut self,
        _: &Connection,
        queue: &QueueHandle<Self>,
        seat: wl_seat::WlSeat,
        capability: Capability,
    ) {
        if capability == Capability::Keyboard && self.keyboard.is_none() {
            let repeat = Box::new(
                |daemon: &mut Self, _: &wl_keyboard::WlKeyboard, event: KeyEvent| {
                    daemon.key_pressed(event);
                },
            );
            match self.globals.seat.get_keyboard_with_repeat(
                queue,
                &seat,
                None,
                self.loop_handle.clone(),
                repeat,
            ) {
                Ok(keyboard) => self.keyboard = Some(keyboard),
                Err(error) => log(&format!("binding the keyboard failed: {error}")),
            }
        }
        if capability == Capability::Pointer && self.pointer.is_none() {
            match self.globals.seat.get_pointer(queue, &seat) {
                Ok(pointer) => self.pointer = Some(pointer),
                Err(error) => log(&format!("binding the pointer failed: {error}")),
            }
        }
    }

    fn remove_capability(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        _: wl_seat::WlSeat,
        capability: Capability,
    ) {
        if capability == Capability::Keyboard
            && let Some(keyboard) = self.keyboard.take()
        {
            keyboard.release();
        }
        if capability == Capability::Pointer
            && let Some(pointer) = self.pointer.take()
        {
            pointer.release();
        }
    }

    fn remove_seat(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_seat::WlSeat) {}
}

impl KeyboardHandler for Daemon {
    fn enter(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        _: &wl_keyboard::WlKeyboard,
        surface: &wl_surface::WlSurface,
        _: u32,
        _: &[u32],
        _: &[Keysym],
    ) {
        if self.is_launcher_surface(surface) {
            trace("ENTER");
        }
    }

    fn leave(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        _: &wl_keyboard::WlKeyboard,
        surface: &wl_surface::WlSurface,
        _: u32,
    ) {
        // Keyboard focus moved to another surface, such as a clicked window.
        if self.is_launcher_surface(surface) {
            self.hide();
        }
    }

    fn press_key(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        _: &wl_keyboard::WlKeyboard,
        _: u32,
        event: KeyEvent,
    ) {
        self.key_pressed(event);
    }

    fn repeat_key(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        _: &wl_keyboard::WlKeyboard,
        _: u32,
        event: KeyEvent,
    ) {
        self.key_pressed(event);
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
        modifiers: Modifiers,
        _: RawModifiers,
        _: u32,
    ) {
        self.modifiers = modifiers;
    }
}

impl PointerHandler for Daemon {
    fn pointer_frame(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        _: &wl_pointer::WlPointer,
        events: &[PointerEvent],
    ) {
        for event in events {
            if !self.is_launcher_surface(&event.surface) {
                continue;
            }
            #[expect(
                clippy::cast_possible_truncation,
                reason = "surface coordinates fit in f32"
            )]
            let position = LogicalPosition::new(event.position.0 as f32, event.position.1 as f32);
            let window = self.window.window();
            match event.kind {
                PointerEventKind::Enter { .. } | PointerEventKind::Motion { .. } => {
                    window.dispatch_event(WindowEvent::PointerMoved { position });
                }
                PointerEventKind::Leave { .. } => window.dispatch_event(WindowEvent::PointerExited),
                PointerEventKind::Press {
                    button: BTN_LEFT, ..
                } => {
                    window.dispatch_event(WindowEvent::PointerPressed {
                        position,
                        button: PointerEventButton::Left,
                    });
                }
                PointerEventKind::Release {
                    button: BTN_LEFT, ..
                } => {
                    window.dispatch_event(WindowEvent::PointerReleased {
                        position,
                        button: PointerEventButton::Left,
                    });
                    if let Some(row) = self.clicked_row.take()
                        && let Some(outcome) =
                            self.view.session_mut().map(|session| session.click(row))
                    {
                        self.apply(outcome);
                    }
                }
                PointerEventKind::Axis { vertical, .. } => {
                    let steps = if vertical.discrete != 0 {
                        vertical.discrete.signum()
                    } else if vertical.absolute.abs() > f64::EPSILON {
                        if vertical.absolute > 0.0 { 1 } else { -1 }
                    } else {
                        0
                    };
                    if steps != 0
                        && let Some(outcome) = self
                            .view
                            .session_mut()
                            .map(|session| session.scroll(steps as isize))
                    {
                        self.apply(outcome);
                    }
                }
                PointerEventKind::Press { .. } | PointerEventKind::Release { .. } => {}
            }
        }
    }
}

impl ShmHandler for Daemon {
    fn shm_state(&mut self) -> &mut Shm {
        &mut self.globals.shm
    }
}

impl ProvidesRegistryState for Daemon {
    fn registry(&mut self) -> &mut RegistryState {
        &mut self.globals.registry
    }

    registry_handlers![OutputState, SeatState];
}

delegate_registry!(Daemon);
smithay_client_toolkit::delegate_dispatch2!(Daemon);
