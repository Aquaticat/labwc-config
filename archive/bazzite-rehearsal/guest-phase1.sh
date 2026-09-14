#!/bin/sh
# Phase 1 (run in guest): enable uwsm COPR, layer labwc+uwsm+companions via rpm-ostree.
set -eu

sudo tee /etc/yum.repos.d/copr-basilcrow-uwsm.repo >/dev/null <<'EOF'
[copr:copr.fedorainfracloud.org:basilcrow:uwsm]
name=Copr repo for uwsm owned by basilcrow
baseurl=https://download.copr.fedorainfracloud.org/results/basilcrow/uwsm/fedora-$releasever-$basearch/
type=rpm-md
skip_if_unavailable=True
gpgcheck=1
gpgkey=https://download.copr.fedorainfracloud.org/results/basilcrow/uwsm/pubkey.gpg
repo_gpgcheck=0
enabled=1
EOF

sudo rpm-ostree install --idempotent uwsm labwc foot fuzzel waybar swaybg wlr-randr
echo PHASE1_OK
