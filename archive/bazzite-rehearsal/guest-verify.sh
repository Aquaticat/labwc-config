#!/bin/sh
# Run in guest over SSH after autologin into the labwc (UWSM) session.
# Collects evidence that the session is systemd/uwsm-managed.
echo "=== booted deployment ==="
rpm-ostree status -b 2>/dev/null | sed -n '1,12p'
echo "=== graphical session ==="
loginctl --no-legend list-sessions
for s in $(loginctl --no-legend list-sessions | awk '{print $1}'); do
  seat=$(loginctl show-session "$s" -p Seat --value 2>/dev/null)
  [ "$seat" = "seat0" ] || continue
  echo "-- session $s:"
  loginctl show-session "$s" -p Type -p Desktop -p Active -p State 2>/dev/null
done
echo "=== uwsm user units ==="
systemctl --user --no-pager --no-legend list-units 'wayland-*' 2>/dev/null
echo "=== process -> systemd unit placement ==="
for p in labwc swaybg foot sddm; do
  ps -o pid=,unit=,cmd= -C "$p" 2>/dev/null | sed "s/^/[$p] /"
done
echo "=== user slice tree (top) ==="
systemd-cgls --user --no-pager 2>/dev/null | head -50
echo "VERIFY_DONE"
