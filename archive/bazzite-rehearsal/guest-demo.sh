#!/bin/sh
# Heavy-load containment demos inside the uwsm-managed labwc session.
# Everything runs in per-app scopes with hard cgroup limits + timeouts.
set -u

list_scopes() { systemctl --user list-units --no-legend --plain 'app-*bash*.scope' 2>/dev/null | awk '{print $1}' | sort; }
LABWC_PID_BEFORE=$(pgrep -x labwc | head -1)
echo "labwc pid before demos: $LABWC_PID_BEFORE"

echo "=== DEMO A: CPU storm (8 spinners) clamped to 1 core via CPUQuota ==="
before=$(list_scopes)
uwsm app -- bash -c 'timeout 40 bash -c "for i in 1 2 3 4 5 6 7 8; do while :; do :; done & done; wait" ' >/dev/null 2>&1 &
sleep 3
after=$(list_scopes)
SCOPE=$(comm -13 <(echo "$before") <(echo "$after") | head -1)
echo "storm scope: $SCOPE"
systemctl --user set-property "$SCOPE" CPUQuota=100%
sleep 10
CG=/sys/fs/cgroup$(systemctl --user show "$SCOPE" -p ControlGroup --value)
echo "-- cpu.max (quota period): $(cat "$CG/cpu.max" 2>/dev/null)"
grep -E 'nr_throttled|throttled_usec' "$CG/cpu.stat" 2>/dev/null
echo "-- top CPU consumers (spinners should share ~100% total, ~12% each):"
ps -eo pcpu,pid,unit,comm --sort=-pcpu | head -12
wait
echo "-- demo A done"

echo ""
echo "=== DEMO B: memory bomb capped at 2G, killed inside its own scope ==="
before=$(list_scopes)
uwsm app -- bash -c 'python3 -c "
import time
l=[]
time.sleep(6)
while True:
    l.append(b\"x\"*(100*1024*1024))
    time.sleep(0.15)
"' >/dev/null 2>&1 &
sleep 3
after=$(list_scopes)
BSCOPE=$(comm -13 <(echo "$before") <(echo "$after") | head -1)
echo "bomb scope: $BSCOPE"
systemctl --user set-property "$BSCOPE" MemoryMax=2G MemorySwapMax=0
BCG=/sys/fs/cgroup$(systemctl --user show "$BSCOPE" -p ControlGroup --value)
echo "-- memory.max: $(cat "$BCG/memory.max" 2>/dev/null)"
# wait for the OOM kill (max ~60s)
i=0
while [ $i -lt 60 ]; do
  oom=$(grep -E '^oom_kill ' "$BCG/memory.events" 2>/dev/null | awk '{print $2}')
  [ -z "$oom" ] && oom=$(systemctl --user show "$BSCOPE" -p Result --value 2>/dev/null | grep -c oom-kill)
  [ "${oom:-0}" -ge 1 ] 2>/dev/null && break
  sleep 2; i=$((i+2))
done
echo "-- scope status after bomb:"
systemctl --user status "$BSCOPE" --no-pager 2>&1 | sed -n '1,6p'
echo "-- kernel OOM record (cgroup-scoped kill, not global):"
sudo journalctl -k -n 40 --no-pager 2>/dev/null | grep -iE 'oom|killed process' | tail -4

echo ""
echo "=== Session survival check ==="
LABWC_PID_AFTER=$(pgrep -x labwc | head -1)
echo "labwc pid after demos:  $LABWC_PID_AFTER (unchanged=$([ "$LABWC_PID_BEFORE" = "$LABWC_PID_AFTER" ] && echo YES || echo NO))"
loginctl show-session "$(loginctl --no-legend list-sessions | awk '$5=="seat0"{print $1;exit}')" -p Active -p State 2>/dev/null
systemctl --user is-active wayland-wm@labwc.service
echo "DEMO_DONE"
