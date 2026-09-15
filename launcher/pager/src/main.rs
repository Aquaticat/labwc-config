//! Pager backend for the sfwbar workspace grid, speaking ext-workspace-v1 to labwc.
//!
//! - `labwc-pager watch` prints the active workspace name whenever it changes, for sfwbar's `ExecClient`,
//!   and reconnects when the compositor restarts.
//! - `labwc-pager activate INDEX|NAME` switches to a workspace by grid index or name.
//! - `labwc-pager next` and `labwc-pager prev` step through the grid in reading order, wrapping.
//!
//! A pager click is a hot path, and QuickJS-ng has no sockets while Deno starts in about 55 ms,
//! so this helper is a native binary; see `doc/decision/typescript-runtime.md`.

mod order;

use std::{
    env, fmt,
    io::{self, Write},
    process::ExitCode,
    thread,
    time::Duration,
};

use wayland_client::{
    Connection, Dispatch, EventQueue, QueueHandle, WEnum, event_created_child,
    globals::{GlobalListContents, registry_queue_init},
    protocol::wl_registry::WlRegistry,
};
use wayland_protocols::ext::workspace::v1::client::{
    ext_workspace_group_handle_v1::{self, ExtWorkspaceGroupHandleV1},
    ext_workspace_handle_v1::{self, ExtWorkspaceHandleV1},
    ext_workspace_manager_v1::{self, ExtWorkspaceManagerV1},
};

use crate::order::{Direction, resolve, step};

/// Usage text for unknown command lines.
const USAGE: &str = "usage: labwc-pager watch | activate INDEX|NAME | next | prev";
/// Delay before `watch` reconnects after losing the compositor.
const RECONNECT_DELAY: Duration = Duration::from_secs(2);

/// Why a pager command failed.
#[derive(Debug)]
enum PagerError {
    /// The command line is not understood.
    Usage(String),
    /// Connecting to or talking with the compositor failed.
    Wayland(String),
    /// The compositor does not offer ext-workspace-v1.
    NoWorkspaceProtocol,
    /// No workspace matches the requested index or name.
    UnknownWorkspace(String),
    /// Writing to standard output failed, for example because sfwbar went away.
    Output(io::Error),
}

impl fmt::Display for PagerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Usage(problem) => write!(formatter, "{problem}\n{USAGE}"),
            Self::Wayland(problem) => write!(formatter, "Wayland: {problem}"),
            Self::NoWorkspaceProtocol => {
                write!(
                    formatter,
                    "the compositor does not offer ext_workspace_manager_v1"
                )
            }
            Self::UnknownWorkspace(target) => write!(formatter, "no workspace matches {target}"),
            Self::Output(error) => {
                write!(formatter, "writing the active workspace failed: {error}")
            }
        }
    }
}

impl std::error::Error for PagerError {}

/// One workspace as the compositor describes it.
struct Workspace {
    /// Protocol object for this workspace.
    handle: ExtWorkspaceHandleV1,
    /// Workspace name, once announced.
    name: Option<String>,
    /// Whether the workspace is active.
    active: bool,
}

/// Workspace state collected from protocol events.
#[derive(Default)]
struct Pager {
    /// Workspaces in announcement order.
    workspaces: Vec<Workspace>,
    /// Whether a `done` event arrived since the flag was last cleared.
    done: bool,
}

impl Pager {
    /// Index of the active workspace.
    fn active(&self) -> Option<usize> {
        self.workspaces
            .iter()
            .position(|workspace| workspace.active)
    }

    /// Names in announcement order, with unnamed workspaces as empty strings.
    fn names(&self) -> Vec<String> {
        self.workspaces
            .iter()
            .map(|workspace| workspace.name.clone().unwrap_or_default())
            .collect()
    }
}

/// A connection with the workspace manager bound and the initial state received.
struct Session {
    /// Event queue for the connection.
    queue: EventQueue<Pager>,
    /// Bound workspace manager.
    manager: ExtWorkspaceManagerV1,
    /// Collected state.
    pager: Pager,
}

/// Maps any displayable Wayland failure into [`PagerError::Wayland`].
fn wayland_error(error: impl fmt::Display) -> PagerError {
    PagerError::Wayland(error.to_string())
}

/// Connects, binds the workspace manager, and waits for the first complete state.
fn connect() -> Result<Session, PagerError> {
    let connection = Connection::connect_to_env().map_err(wayland_error)?;
    let (globals, mut queue) = registry_queue_init::<Pager>(&connection).map_err(wayland_error)?;
    let manager = globals
        .bind::<ExtWorkspaceManagerV1, _, _>(&queue.handle(), 1..=1, ())
        .map_err(|_| PagerError::NoWorkspaceProtocol)?;
    let mut pager = Pager::default();
    queue.roundtrip(&mut pager).map_err(wayland_error)?;
    Ok(Session {
        queue,
        manager,
        pager,
    })
}

/// Activates workspace `index` and waits until the compositor processed the request.
fn activate(session: &mut Session, index: usize) -> Result<(), PagerError> {
    let Some(workspace) = session.pager.workspaces.get(index) else {
        return Err(PagerError::UnknownWorkspace(index.to_string()));
    };
    workspace.handle.activate();
    session.manager.commit();
    session
        .queue
        .roundtrip(&mut session.pager)
        .map_err(wayland_error)?;
    Ok(())
}

/// Prints the active workspace name on every change until the connection fails.
fn watch_once(last: &mut Option<String>) -> Result<(), PagerError> {
    let mut session = connect()?;
    let mut output = io::stdout().lock();
    loop {
        let active = session
            .pager
            .active()
            .and_then(|index| session.pager.workspaces[index].name.clone());
        if active.is_some() && active != *last {
            if let Some(name) = &active {
                writeln!(output, "{name}")
                    .and_then(|()| output.flush())
                    .map_err(PagerError::Output)?;
            }
            *last = active;
        }
        session.pager.done = false;
        while !session.pager.done {
            session
                .queue
                .blocking_dispatch(&mut session.pager)
                .map_err(wayland_error)?;
        }
    }
}

/// Runs the command named by the arguments after the program name.
fn run(arguments: &[String]) -> Result<(), PagerError> {
    match arguments {
        [command] if command == "watch" => {
            let mut last = None;
            loop {
                match watch_once(&mut last) {
                    Err(PagerError::Output(error)) => return Err(PagerError::Output(error)),
                    Err(error) => eprintln!("labwc-pager: {error}; reconnecting"),
                    Ok(()) => {}
                }
                thread::sleep(RECONNECT_DELAY);
            }
        }
        [command, target] if command == "activate" => {
            let mut session = connect()?;
            let index = resolve(target, &session.pager.names())
                .ok_or_else(|| PagerError::UnknownWorkspace(target.clone()))?;
            activate(&mut session, index)
        }
        [command] if command == "next" || command == "prev" => {
            let direction = if command == "next" {
                Direction::Next
            } else {
                Direction::Previous
            };
            let mut session = connect()?;
            let target = step(
                session.pager.active(),
                session.pager.workspaces.len(),
                direction,
            )
            .ok_or_else(|| PagerError::UnknownWorkspace(command.clone()))?;
            activate(&mut session, target)
        }
        _ => Err(PagerError::Usage(format!(
            "unknown command line: {}",
            arguments.join(" ")
        ))),
    }
}

/// Runs the pager, reporting failures on standard error.
fn main() -> ExitCode {
    let arguments: Vec<String> = env::args().skip(1).collect();
    match run(&arguments) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("labwc-pager: {error}");
            ExitCode::FAILURE
        }
    }
}

impl Dispatch<WlRegistry, GlobalListContents> for Pager {
    fn event(
        _: &mut Self,
        _: &WlRegistry,
        _: wayland_client::protocol::wl_registry::Event,
        _: &GlobalListContents,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

impl Dispatch<ExtWorkspaceManagerV1, ()> for Pager {
    fn event(
        pager: &mut Self,
        _: &ExtWorkspaceManagerV1,
        event: ext_workspace_manager_v1::Event,
        (): &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        match event {
            ext_workspace_manager_v1::Event::Workspace { workspace } => {
                pager.workspaces.push(Workspace {
                    handle: workspace,
                    name: None,
                    active: false,
                });
            }
            ext_workspace_manager_v1::Event::Done => pager.done = true,
            _ => {}
        }
    }

    event_created_child!(Pager, ExtWorkspaceManagerV1, [
        ext_workspace_manager_v1::EVT_WORKSPACE_GROUP_OPCODE => (ExtWorkspaceGroupHandleV1, ()),
        ext_workspace_manager_v1::EVT_WORKSPACE_OPCODE => (ExtWorkspaceHandleV1, ()),
    ]);
}

impl Dispatch<ExtWorkspaceHandleV1, ()> for Pager {
    fn event(
        pager: &mut Self,
        handle: &ExtWorkspaceHandleV1,
        event: ext_workspace_handle_v1::Event,
        (): &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        let position = pager
            .workspaces
            .iter()
            .position(|workspace| &workspace.handle == handle);
        let Some(position) = position else {
            return;
        };
        match event {
            ext_workspace_handle_v1::Event::Name { name } => {
                pager.workspaces[position].name = Some(name);
            }
            ext_workspace_handle_v1::Event::State { state } => {
                pager.workspaces[position].active = matches!(
                    state,
                    WEnum::Value(flags) if flags.contains(ext_workspace_handle_v1::State::Active)
                );
            }
            ext_workspace_handle_v1::Event::Removed => {
                pager.workspaces.remove(position).handle.destroy();
            }
            _ => {}
        }
    }
}

impl Dispatch<ExtWorkspaceGroupHandleV1, ()> for Pager {
    fn event(
        _: &mut Self,
        _: &ExtWorkspaceGroupHandleV1,
        _: ext_workspace_group_handle_v1::Event,
        (): &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}
