# Installed as /etc/profile.d/labwc-config.sh.
# Starts the labwc session from a fresh login shell on the first virtual terminal,
# which getty's autologin drop-in provides; uwsm's own check refuses SSH, nested, and already-running sessions.
if [ "$(id --user)" -ne 0 ] && uwsm check may-start -q; then
  exec uwsm start -- /usr/bin/labwc
fi
