#!/bin/bash
# Shortcut guard: Meta+F12 suspends the entire shortcut stack (labwc binds via
# ToggleKeybinds + meta-tap watcher via flag file) for remote-desktop use.
set -eu

# wayland-utils for protocol verification, live-applied (no reboot needed)
sudo rpm-ostree install --idempotent --apply-live -y wayland-utils >/dev/null 2>&1 || true

mkdir -p ~/.local/bin ~/.cache
cat > ~/.local/bin/toggle-shortcut-guard <<'EOF'
#!/bin/sh
FLAG="$HOME/.cache/shortcuts-suspended"
if [ -e "$FLAG" ]; then
  rm -f "$FLAG"
  notify-send -t 2000 "Shortcuts restored" "Global shortcuts active again" 2>/dev/null || true
else
  touch "$FLAG"
  notify-send -t 2000 "Shortcuts suspended" "Keys pass through (Meta+F12 to restore)" 2>/dev/null || true
fi
EOF
chmod +x ~/.local/bin/toggle-shortcut-guard

# Watcher: respect the flag file
python3 - <<'EOF'
import pathlib
p = pathlib.Path.home() / ".local/bin/meta-tap-launcher"
src = p.read_text()
if "shortcuts-suspended" not in src:
    src = src.replace(
        'import select\nimport subprocess',
        'import os.path\nimport select\nimport subprocess'
    ).replace(
        '                        if armed and ev.timestamp() - t_down <= TAP_TIMEOUT_S:',
        '                        flag = os.path.expanduser("~/.cache/shortcuts-suspended")\n'
        '                        if armed and ev.timestamp() - t_down <= TAP_TIMEOUT_S \\\n'
        '                                and not os.path.exists(flag):'
    )
    p.write_text(src)
    print("watcher patched")
else:
    print("watcher already patched")
EOF

# labwc: Meta+F12 toggles compositor keybinds AND the watcher flag atomically
if ! grep -q 'ToggleKeybinds' ~/.config/labwc/rc.xml; then
  sed -i 's|  </keyboard>|    <keybind key="W-F12"><action name="ToggleKeybinds"/><action name="Execute" command="~/.local/bin/toggle-shortcut-guard"/></keybind>\n  </keyboard>|' ~/.config/labwc/rc.xml
fi
python3 -c 'import xml.etree.ElementTree as ET, os; ET.parse(os.path.expanduser("~/.config/labwc/rc.xml"))' && echo XML_VALID

# Apply live: reload labwc config, restart watcher
pkill -HUP -x labwc || true
pkill -f meta-tap-launcher || true
export XDG_RUNTIME_DIR=/run/user/$(id -u)
WD=$(systemctl --user show-environment 2>/dev/null | sed -n 's/^WAYLAND_DISPLAY=//p')
export WAYLAND_DISPLAY=${WD:-wayland-0}
uwsm app -- ~/.local/bin/meta-tap-launcher >/dev/null 2>&1 &
sleep 1

echo "--- keyboard-shortcuts-inhibit protocol support:"
wayland-info 2>/dev/null | grep -A1 shortcuts_inhibit || echo "NOT ADVERTISED"
echo GUARD_OK
