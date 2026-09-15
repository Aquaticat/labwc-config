/**
 Installs CachyOS with the labwc session from the live ISO.

 ```sh
 deno run --allow-all installer/src/install.main.ts --machine machine.json
 ```

 @module
 */

import { tagged, } from '@monochromatic-dev/module-logger';

import { install, } from './install.ts';
import { parseMachine, } from './machine.ts';
import {
  askSecret,
  confirmPhrase,
} from './prompt.ts';
import { createSystemShell, } from './shell.ts';

const l = tagged({ tag: 'install-main', },);

/** Thrown when the installer is started without what it needs. */
class InstallerUsageError extends Error {
  /**
   @param message - what is missing
   */
  constructor(message: string,) {
    super(message,);
    this.name = InstallerUsageError.name;
  }
}

/**
 Reads a file next to this module.

 @param relative - path relative to this module
 @returns file content
 @example
 ```ts
 const script = await readSibling('../shim/95-shim-limine-copy.sh',);
 ```
 */
async function readSibling(relative: string,): Promise<string> {
  return await Deno.readTextFile(new URL(relative, import.meta.url,),);
}

/**
 Checks that the live system booted in UEFI mode.

 @returns whether efivars exist, which Secure Boot enrollment needs
 @example
 ```ts
 const uefi = await bootedWithUefi();
 ```
 */
async function bootedWithUefi(): Promise<boolean> {
  try {
    return (await Deno.stat('/sys/firmware/efi',)).isDirectory;
  } catch (error) {
    l.warn(`/sys/firmware/efi is unavailable: ${String(error,)}`,);
    return false;
  }
}

const machinePathIndex =Deno.args.indexOf('--machine',);
const machinePath = machinePathIndex >= 0 ? Deno.args[machinePathIndex + 1] : undefined;
if (machinePath === undefined) {
  throw new InstallerUsageError('usage: install.main.ts --machine machine.json',);
}
if (Deno.uid() !== 0) {
  throw new InstallerUsageError('run the installer as root',);
}
if (!(await bootedWithUefi())) {
  throw new InstallerUsageError('the live system did not boot in UEFI mode',);
}

const machineJson = await Deno.readTextFile(machinePath,);
const machine = parseMachine(JSON.parse(machineJson,),);
await confirmPhrase({
  explanation: `This erases every partition on ${machine.targetDisk} and installs ${machine.hostname} (${machine.platform}).`,
  phrase: machine.hostname,
},);
const secrets = {
  luksPassphrase: await askSecret('Temporary LUKS passphrase (also the one-time MOK password on Hyper-V)',),
  userPassword: await askSecret(`Password for ${machine.username}`,),
  rootPassword: await askSecret('Root password for emergency mode',),
};

await install({
  machine,
  shell: createSystemShell(),
  secrets,
  luksUuid: crypto.randomUUID(),
  hooks: {
    sbatBuilder: await readSibling('../shim/limine-sbat-build.ts',),
    limineCopy: await readSibling('../shim/95-shim-limine-copy.sh',),
  },
  // A directory URL ends with a slash, which cp's --no-target-directory form must not see.
  checkout: new URL('../../', import.meta.url,).pathname.slice(0, -1,),
  machineJson,
},);

l.info('Installed. Next:',);
l.info('1. umount --recursive /mnt && cryptsetup close labwc-config-target && reboot',);
l.info(
  machine.platform === 'physical'
    ? '2. Enable Secure Boot in the firmware if it is not already enforcing.'
    : '2. At the blue MokManager screen choose Enroll MOK, Continue, Yes, and type the temporary LUKS passphrase.',
);
l.info('3. Unlock with the temporary passphrase, log in, and run as root:',);
l.info('   deno run --allow-all /root/labwc-config/installer/src/first-boot.main.ts',);
await l.flush();
