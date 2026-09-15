/**
 Replaces the temporary LUKS passphrase with TPM2 plus PIN and a recovery key.

 Run as root on the installed system once Secure Boot enforces the final keys:

 ```sh
 deno run --allow-all /root/labwc-config/installer/src/first-boot.main.ts
 ```

 @module
 */

import { tagged, } from '@monochromatic-dev/module-logger';

import {
  enrollUnlocking,
  removePassphrase,
} from './first-boot.ts';
import { parseMachine, } from './machine.ts';
import {
  askSecret,
  PromptDeclinedError,
  readVisibleLine,
} from './prompt.ts';
import { createSystemShell, } from './shell.ts';

const l = tagged({ tag: 'first-boot-main', },);

if (Deno.uid() !== 0) {
  throw new PromptDeclinedError('run first-boot enrollment as root',);
}
const machine = parseMachine(JSON.parse(await Deno.readTextFile(new URL('../../machine.json', import.meta.url,),),),);
const shell = createSystemShell();
const passphrase = await askSecret('Temporary LUKS passphrase',);
const pin = await askSecret('New boot PIN',);
const { device, recoveryKey, } = await enrollUnlocking({ platform: machine.platform, shell, passphrase, pin, },);

// The recovery key is shown once on the console for the owner to record; it is deliberately not logged.
await Deno.stdout.write(
  new TextEncoder().encode(
    `\nRecovery key for ${device}:\n\n    ${recoveryKey}\n\nRecord it somewhere off this machine, then type it back to remove the temporary passphrase:\n`,
  ),
);
const typedBack = (await readVisibleLine()).trim();
if (typedBack !== recoveryKey) {
  l.error('the typed recovery key did not match; the temporary passphrase stays enrolled',);
  throw new PromptDeclinedError('recovery key confirmation did not match',);
}
await removePassphrase({ shell, device, recoveryKey, },);
l.info('Done. Reboot and unlock with the PIN.',);
await l.flush();
