# Installed as /usr/share/fish/vendor_conf.d/labwc-config.fish.
# Starts the labwc session from a fresh login shell on the first virtual terminal,
# which getty's autologin drop-in provides; uwsm's own check refuses SSH, nested, and already-running sessions.
if status is-login; and test (id --user) -ne 0; and uwsm check may-start -q
    exec uwsm start -- /usr/bin/labwc
end
