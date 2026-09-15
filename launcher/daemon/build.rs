//! Compiles the launcher's Slint interface.

fn main() {
    slint_build::compile("ui/launcher.slint").expect("ui/launcher.slint compiles");
}
