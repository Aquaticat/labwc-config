# Bazzite rehearsal archive

This directory is the labwc plus UWSM rehearsal as it was published on 2026-09-14,
before the repository was retargeted at CachyOS.
Paths inside its documents are relative to this directory,
so `final-configs/rc.xml` means `archive/bazzite-rehearsal/final-configs/rc.xml`.

It is kept for evidence and history.
Nothing here is deployed,
and its shell and Python helpers predate the TypeScript ports that replace them.
The documents do not follow the repository's prose standards and are not updated.

## What to read instead

- `README.md` at the repository root for the current CachyOS target.
- The Monochromatic handover `doc/handover/leave-bazzite-cachyos-btrfs.md`
  for the decisions that retargeted this repository.

## What still has value here

- `HANDOVER.md` and `YOUR-SETUP.md`:
  verified labwc,
  sfwbar,
  fuzzel,
  xwayland-satellite,
  and launch-feedback facts with their evidence dates.
  Durable gotchas were copied into `doc/troubleshooting/` at the repository root.
- `MIGRATION-PLAN.md`:
  the cgroup contention demo.
  Its opening claim that UWSM isolation fixes the Bazzite stutter is not supported by host evidence;
  the stall investigation in Monochromatic associates the stalls with Btrfs qgroup accounting and storage pressure.
  Its `MemoryHigh=80%` slice limit is not carried forward.
- `logs/`:
  serial logs,
  demo outputs,
  and screenshots referenced by those documents.
