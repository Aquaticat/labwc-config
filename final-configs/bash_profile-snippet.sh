# Append to ~/.bash_profile — DM-less labwc session.
# `uwsm check may-start` is true only for a fresh login on a VT (not ssh, not
# nested shells), so this never hijacks non-graphical logins. When the session
# ends, the exec'd shell is gone -> getty@tty1 respawns -> autologin -> the
# session restarts automatically.

# DM-less labwc session: on fresh tty login, hand over to uwsm
if uwsm check may-start; then
  exec uwsm start -- /usr/bin/labwc
fi
