/**
 Tests for Snapper configuration.

 @module
 */

import {
  describe,
  expect,
  it,
} from '@monochromatic-dev/module-test';

import { limineDefaults, } from './base.ts';
import {
  commandsOf,
  createRecordingShell,
  writtenFile,
} from './recording-shell.ts';
import {
  applySnapperSettings,
  CLEANUP_TIMER_DROP_IN,
  configureSnapshots,
  SNAPSHOT_ENTRY_LIMIT,
} from './snapshots.ts';

/** Excerpt of the cachyos-root template as the VM's /etc/snapper/configs/root showed it on 2026-09-14. */
const TEMPLATE = [
  '# subvolume to snapshot',
  'SUBVOLUME="/"',
  'QGROUP=""',
  'SPACE_LIMIT="0.5"',
  'NUMBER_LIMIT="50"',
  'NUMBER_LIMIT_IMPORTANT="15"',
  'TIMELINE_CREATE="no"',
  'TIMELINE_LIMIT_HOURLY="5"',
  'TIMELINE_LIMIT_DAILY="7"',
  '',
].join('\n',);

/**
 Reads one key from Snapper configuration text.

 @param text - configuration
 @param key - variable name
 @returns every value assigned to the key, so duplicates are visible
 @example
 ```ts
 const values = valuesOf({ text, key: 'QGROUP', },);
 ```
 */
function valuesOf({ text, key, }: { readonly text: string; readonly key: string; },): readonly string[] {
  return text.split('\n',).filter((line,) => line.startsWith(`${key}=`,)).map((line,) => line.slice(key.length + 1,));
}

/**
 Runs `configureSnapshots` against a recording shell holding the template.

 @returns recorded calls
 @example
 ```ts
 const calls = await configure();
 ```
 */
async function configure() {
  const recording = createRecordingShell({
    captures: {},
    files: { '/mnt/etc/snapper/configs/root': TEMPLATE, '/mnt/etc/limine-snapper-sync.conf': 'TARGET_OS_NAME="Arch"\n', },
  },);
  await configureSnapshots({ shell: recording.shell, },);
  return recording.calls;
}

await describe({
  name: 'snapshots',
  children: [
    it({
      name: 'creates hourly timeline snapshots with qgroups off and bounded retention',
      fn: async () => {
        const config = writtenFile({ calls: await configure(), path: '/mnt/etc/snapper/configs/root', },)?.content ?? '';
        expect(valuesOf({ text: config, key: 'TIMELINE_CREATE', },),).toEqual(['"yes"',],);
        expect(valuesOf({ text: config, key: 'QGROUP', },),).toEqual(['""',],);
        expect(valuesOf({ text: config, key: 'NUMBER_LIMIT', },),).toEqual(['"10"',],);
        expect(valuesOf({ text: config, key: 'TIMELINE_LIMIT_WEEKLY', },),).toEqual(['"4"',],);
        expect(valuesOf({ text: config, key: 'SPACE_LIMIT', },),).toEqual(['"0.5"',],);
      },
    },),
    it({
      name: 'keeps every retained snapshot bootable by matching the Limine entry limit to the retention bound',
      fn: async () => {
        expect(SNAPSHOT_ENTRY_LIMIT,).toEqual(24 + 7 + 4 + 10 + 5,);
        expect(limineDefaults({ platform: 'physical', commandLine: 'rw', },),).toContain(
          `MAX_SNAPSHOT_ENTRIES=${SNAPSHOT_ENTRY_LIMIT}\n`,
        );
        // The rehearsal VM defaulted to linux-cachyos-lts with the wildcard-only order.
        expect(limineDefaults({ platform: 'physical', commandLine: 'rw', },),).toContain(
          'BOOT_ORDER="linux-cachyos, *, *fallback, Snapshots"\n',
        );
      },
    },),
    it({
      name: 'moves cleanup to night with catch-up at boot and enables the timeline timer',
      fn: async () => {
        const calls = await configure();
        expect(
          writtenFile({ calls, path: '/mnt/etc/systemd/system/snapper-cleanup.timer.d/nightly.conf', },)?.content,
        ).toEqual(CLEANUP_TIMER_DROP_IN,);
        expect(CLEANUP_TIMER_DROP_IN,).toContain('OnUnitActiveSec=\n',);
        expect(CLEANUP_TIMER_DROP_IN,).toContain('Persistent=true\n',);
        expect(commandsOf(calls,),).toContainEqual([
          'arch-chroot',
          '/mnt',
          'systemctl',
          'enable',
          'snapper-timeline.timer',
          'snapper-cleanup.timer',
          'limine-snapper-sync.service',
        ],);
      },
    },),
    it({
      name: 'replaces existing keys in place, appends missing ones, and leaves comments alone',
      fn: async () => {
        const text = applySnapperSettings({
          text: '# QGROUP="1/0"\nQGROUP="1/0"\nOTHER="x"\n',
          settings: { QGROUP: '', TIMELINE_CREATE: 'yes', },
        },);
        expect(text,).toEqual('# QGROUP="1/0"\nQGROUP=""\nOTHER="x"\nTIMELINE_CREATE="yes"\n',);
      },
    },),
  ],
},);
