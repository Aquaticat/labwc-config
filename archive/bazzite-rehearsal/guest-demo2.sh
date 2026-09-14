#!/bin/bash
# Contention demo: UNLIMITED hogs inside the VM; the only resource limit is
# the VM's vCPU count. Two probes:
#   - latency: wlr-randr Wayland round-trip to the live compositor
#   - throughput: single-threaded "renderer" benchmark (iterations in 8s),
#     showing the CPU share a session-side process gets under contention.
set -u
N=5
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
WD=$(systemctl --user show-environment 2>/dev/null | sed -n 's/^WAYLAND_DISPLAY=//p')
export WAYLAND_DISPLAY=${WD:-wayland-0}
echo "vCPUs: $(nproc)"

CG=/sys/fs/cgroup$(systemctl --user show wayland-wm@labwc.service -p ControlGroup --value)
echo "compositor cgroup: $CG"

lat() {
  local label=$1 t
  for i in $(seq $N); do
    t=$({ TIMEFORMAT=%R; time timeout 15 wlr-randr >/dev/null 2>&1; } 2>&1)
    echo "lat[$label] $i: ${t}s"
  done
}

BENCH='import time
n=0; t0=time.time()
while time.time()-t0 < 8: n+=1
print(n)'

bench() {  # bench <label> <flat|app|session> — run renderer probe, print iterations
  local label=$1 mode=$2 out pid slicearg=""
  [ "$mode" = session ] && slicearg="--slice=session.slice"
  out=$(mktemp)
  systemd-run --user --scope --quiet --unit="bench-$label" $slicearg \
    python3 -c "$BENCH # BENCHMARK_$label" >"$out" 2>/dev/null &
  local srpid=$!
  sleep 0.7
  if [ "$mode" = flat ]; then
    pid=$(pgrep -f "BENCHMARK_$label" | head -1)
    [ -n "$pid" ] && echo "$pid" > "$CG/cgroup.procs" 2>/dev/null
  fi
  pid=$(pgrep -f "BENCHMARK_$label" | head -1)
  [ -n "$pid" ] && echo "bench[$label] cgroup: $(cut -d: -f3 /proc/$pid/cgroup | head -1)"
  wait $srpid 2>/dev/null
  echo "bench[$label] iterations: $(cat "$out")"
  rm -f "$out"
}

spin_start_flat() {
  systemd-run --user --scope --unit=hog-flat --quiet bash -c \
    'for i in 1 2 3 4 5 6 7 8; do (exec -a spinnerflat bash -c "while :; do :; done") & done; sleep 300' &
  sleep 3
  local moved=0 pid
  for pid in $(pgrep -f spinnerflat); do
    echo "$pid" > "$CG/cgroup.procs" 2>/dev/null && moved=$((moved+1))
  done
  echo "spinners moved into compositor cgroup: $moved"
}

echo "=== A: idle baseline ==="
lat idle
bench alone app

echo "=== B: FLAT — 8 unlimited spinners + renderer all inside the compositor's cgroup ==="
spin_start_flat
lat flat
bench flat flat
pkill -f spinnerflat; systemctl --user stop hog-flat.scope 2>/dev/null; sleep 2

echo "=== C: SCOPED — spinners via uwsm app (unlimited, app-graphical.slice); renderer in session.slice ==="
uwsm app -- bash -c 'for i in 1 2 3 4 5 6 7 8; do (exec -a spinnerscoped bash -c "while :; do :; done") & done; sleep 300' >/dev/null 2>&1 &
sleep 3
p=$(pgrep -f spinnerscoped | head -1)
[ -n "$p" ] && echo "spinner cgroup: $(cut -d: -f3 /proc/$p/cgroup | head -1)"
lat scoped
bench scoped-app app
bench scoped-session session
pkill -f spinnerscoped; sleep 1

echo "=== cgroup weights in play (untuned Bazzite defaults) ==="
for s in session.slice app.slice; do
  echo "$s cpu.weight: $(cat /sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service/$s/cpu.weight 2>/dev/null)"
done

if [ "${RUN_MEMBOMB:-0}" = 1 ]; then
  echo "=== D: UNLIMITED memory bomb via uwsm app — global pressure, who dies? ==="
  LP=$(pgrep -x labwc | head -1)
  uwsm app -- python3 -c '
l=[]
import time
while True:
    l.append(b"x"*(200*1024*1024))
    time.sleep(0.1)
' >/dev/null 2>&1 &
  for i in $(seq 60); do
    sudo dmesg 2>/dev/null | grep -qiE 'out of memory|oom-kill' && break
    sleep 2
  done
  sleep 3
  sudo dmesg 2>/dev/null | grep -iE 'oom-kill|out of memory|killed process' | tail -4
  echo "labwc pid: was $LP, now $(pgrep -x labwc | head -1)"
  echo "compositor unit: $(systemctl --user is-active wayland-wm@labwc.service)"
  lat post-oom
fi
echo DEMO2_DONE
