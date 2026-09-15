/**
 Configures Snapper timeline snapshots of `/` and keeps each one bootable from Limine.

 @module
 */

import { tagged, } from '@monochromatic-dev/module-logger';

import {
  inTarget,
  type Shell,
  TARGET_ROOT,
} from './shell.ts';

/**
 Snapper settings the decision fixes, applied over the `cachyos-root` template.

 Qgroups stay off because the Bazzite stalls were associated with qgroup accounting during cleanup.
 Retention is bounded so the Limine snapshot menu can hold every retained snapshot.
 */
export const SNAPPER_SETTINGS: Readonly<Record<string, string>> = {
  QGROUP: '',
  TIMELINE_CREATE: 'yes',
  TIMELINE_CLEANUP: 'yes',
  TIMELINE_LIMIT_HOURLY: '24',
  TIMELINE_LIMIT_DAILY: '7',
  TIMELINE_LIMIT_WEEKLY: '4',
  TIMELINE_LIMIT_MONTHLY: '0',
  TIMELINE_LIMIT_YEARLY: '0',
  NUMBER_CLEANUP: 'yes',
  NUMBER_LIMIT: '10',
  NUMBER_LIMIT_IMPORTANT: '5',
};

/** Retention keys whose values add up to the most snapshots Snapper keeps at once. */
const RETENTION_KEYS = [
  'TIMELINE_LIMIT_HOURLY',
  'TIMELINE_LIMIT_DAILY',
  'TIMELINE_LIMIT_WEEKLY',
  'TIMELINE_LIMIT_MONTHLY',
  'TIMELINE_LIMIT_YEARLY',
  'NUMBER_LIMIT',
  'NUMBER_LIMIT_IMPORTANT',
] as const;

/** Most snapshots Snapper retains, which is also Limine's snapshot entry limit. */
export const SNAPSHOT_ENTRY_LIMIT = RETENTION_KEYS.reduce(
  (total, key,) => total + Number(SNAPPER_SETTINGS[key] ?? '0',),
  0,
);

/** Runs cleanup at night, and at boot when the machine was off at night. */
export const CLEANUP_TIMER_DROP_IN = [
  '[Timer]',
  '# Clears the template schedule of 10 minutes after boot and hourly after that.',
  'OnBootSec=',
  'OnUnitActiveSec=',
  'OnCalendar=*-*-* 03:00:00',
  'Persistent=true',
  '',
].join('\n',);

/**
 Rewrites Snapper configuration values, appending keys the file lacks.

 @param text - existing configuration
 @param settings - values to force
 @returns configuration with every setting applied exactly once
 @example
 ```ts
 const updated = applySnapperSettings({ text, settings: SNAPPER_SETTINGS, },);
 ```
 */
export function applySnapperSettings({ text, settings, }: {
  readonly text: string;
  readonly settings: Readonly<Record<string, string>>;
},): string {
  const lines = text.split('\n',).filter((line, index, all,) => index < all.length - 1 || line !== '');
  const keyOf = (line: string,): string => line.slice(0, line.indexOf('=',),);
  const replaced = lines.map((line,) =>
    line.includes('=',) && !line.startsWith('#',) && keyOf(line,) in settings
      ? `${keyOf(line,)}="${settings[keyOf(line,)]}"`
      : line
  );
  const present = new Set(replaced.filter((line,) => line.includes('=',)).map(keyOf,),);
  const appended = Object.entries(settings,)
    .filter(([key,],) => !present.has(key,))
    .map(([key, value,],) => `${key}="${value}"`);
  return `${[...replaced, ...appended,].join('\n',)}\n`;
}

/**
 Creates the root Snapper configuration,
 applies the decided retention,
 and enables the timers and the Limine snapshot sync.

 @param shell - side effects
 @example
 ```ts
 await configureSnapshots({ shell, },);
 ```
 */
export async function configureSnapshots({ shell, }: { readonly shell: Shell; },): Promise<void> {
  const l = tagged({ tag: configureSnapshots.name, },);
  // The package's install script creates the root config from the cachyos-root template.
  await shell.run({
    description: 'install CachyOS Snapper support',
    argv: inTarget(['pacman', '--sync', '--noconfirm', '--needed', 'cachyos-snapper-support',],),
  },);
  const configPath = `${TARGET_ROOT}/etc/snapper/configs/root`;
  await shell.writeFile({
    description: 'Snapper retention without qgroups',
    path: configPath,
    content: applySnapperSettings({ text: await shell.readFile(configPath,), settings: SNAPPER_SETTINGS, },),
    mode: 0o640,
  },);
  await shell.writeFile({
    description: 'nightly Snapper cleanup with boot catch-up',
    path: `${TARGET_ROOT}/etc/systemd/system/snapper-cleanup.timer.d/nightly.conf`,
    content: CLEANUP_TIMER_DROP_IN,
    mode: 0o644,
  },);
  await shell.writeFile({
    description: 'Limine snapshot entries name the distribution',
    path: `${TARGET_ROOT}/etc/limine-snapper-sync.conf`,
    content: applySnapperSettings({
      text: await shell.readFile(`${TARGET_ROOT}/etc/limine-snapper-sync.conf`,),
      settings: { TARGET_OS_NAME: 'CachyOS', },
    },),
    mode: 0o644,
  },);
  await shell.writeFile({
    description: 'initramfs hook that boots read-only snapshots through overlayfs',
    path: `${TARGET_ROOT}/etc/mkinitcpio.conf.d/10-limine-snapper-sync.conf`,
    content: 'HOOKS+=(sd-btrfs-overlayfs)\n',
    mode: 0o644,
  },);
  await shell.run({
    description: 'enable snapshot timers and Limine snapshot sync',
    argv: inTarget(['systemctl', 'enable', 'snapper-timeline.timer', 'snapper-cleanup.timer', 'limine-snapper-sync.service',],),
  },);
  l.info(`Snapper keeps at most ${SNAPSHOT_ENTRY_LIMIT} snapshots`,);
}

/**
 Takes the snapshot the installed system can always roll back to.

 @param shell - side effects
 @example
 ```ts
 await createInstallSnapshot({ shell, },);
 ```
 */
export async function createInstallSnapshot({ shell, }: { readonly shell: Shell; },): Promise<void> {
  await shell.run({
    description: 'snapshot the fresh installation',
    argv: inTarget([
      'snapper',
      '--no-dbus',
      '--config',
      'root',
      'create',
      '--description',
      'Fresh installation',
      '--userdata',
      'important=yes',
    ],),
  },);
}
