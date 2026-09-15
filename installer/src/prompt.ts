/**
 Asks the person at the console for confirmations and secrets.

 Prompts go straight to the terminal:
 they are the installer's user interface,
 not log records.

 @module
 */

/** Thrown when the person at the console declines or mistypes a confirmation. */
export class PromptDeclinedError extends Error {
  /**
   @param message - which confirmation failed
   */
  constructor(message: string,) {
    super(message,);
    this.name = PromptDeclinedError.name;
  }
}

/** Byte the terminal sends for Enter in raw mode. */
const CARRIAGE_RETURN = 0x0d;

/** Byte the terminal sends for Enter when input is a pipe. */
const LINE_FEED = 0x0a;

/** Byte for Backspace on Linux consoles. */
const DELETE = 0x7f;

/** Byte for Ctrl+C in raw mode. */
const END_OF_TEXT = 0x03;

/**
 Writes prompt text to the terminal.

 @param text - text to show
 @example
 ```ts
 await show('Passphrase: ',);
 ```
 */
async function show(text: string,): Promise<void> {
  await Deno.stdout.write(new TextEncoder().encode(text,),);
}

/**
 Turns off terminal echo until disposed.

 @returns disposable that restores echo and ends the hidden line
 @example
 ```ts
 using _echoOff = hideEcho();
 ```
 */
function hideEcho(): Disposable {
  const interactive = Deno.stdin.isTerminal();
  if (interactive) {
    Deno.stdin.setRaw(true,);
  }
  return {
    [Symbol.dispose]: () => {
      if (interactive) {
        Deno.stdin.setRaw(false,);
      }
      // Raw mode swallowed the Enter key's line break.
      Deno.stdout.writeSync(new TextEncoder().encode('\n',),);
    },
  };
}

/**
 Reads one line from standard input without echoing it.

 @param label - what to type
 @returns typed text
 @throws {PromptDeclinedError} when the person presses Ctrl+C or input ends
 @example
 ```ts
 const pin = await readHidden('PIN',);
 ```
 */
async function readHidden(label: string,): Promise<string> {
  await show(`${label}: `,);
  using _echoOff = hideEcho();
  const typed: number[] = [];
  const buffer = new Uint8Array(1,);
  while (true) {
    const count = await Deno.stdin.read(buffer,);
    const byte = buffer[0];
    if (count === null || byte === END_OF_TEXT) {
      throw new PromptDeclinedError(`${label} was not entered`,);
    }
    if (byte === CARRIAGE_RETURN || byte === LINE_FEED) {
      break;
    }
    if (byte === DELETE) {
      typed.pop();
    } else if (byte !== undefined) {
      typed.push(byte,);
    }
  }
  return new TextDecoder().decode(new Uint8Array(typed,),);
}

/**
 Asks for a secret twice and returns it when both entries match.

 @param label - what the secret is
 @returns secret
 @throws {PromptDeclinedError} when the entries differ or are empty
 @example
 ```ts
 const passphrase = await askSecret('Temporary LUKS passphrase',);
 ```
 */
export async function askSecret(label: string,): Promise<string> {
  const first = await readHidden(label,);
  const second = await readHidden(`${label} again`,);
  if (first === '' || first !== second) {
    throw new PromptDeclinedError(`${label}: the entries were empty or did not match`,);
  }
  return first;
}

/**
 Reads one visible line from standard input.

 @returns line without its line ending
 @throws {PromptDeclinedError} when input ends first
 @example
 ```ts
 const answer = await readVisibleLine();
 ```
 */
export async function readVisibleLine(): Promise<string> {
  const typed: number[] = [];
  const buffer = new Uint8Array(1,);
  while (true) {
    const count = await Deno.stdin.read(buffer,);
    const byte = buffer[0];
    if (count === null) {
      throw new PromptDeclinedError('input ended',);
    }
    if (byte === LINE_FEED) {
      break;
    }
    if (byte !== undefined && byte !== CARRIAGE_RETURN) {
      typed.push(byte,);
    }
  }
  return new TextDecoder().decode(new Uint8Array(typed,),);
}

/**
 Requires the person to type an exact phrase.

 @param explanation - what happens after confirming
 @param phrase - text to type
 @throws {PromptDeclinedError} when the typed text differs
 @example
 ```ts
 await confirmPhrase({ explanation: 'This erases the disk.', phrase: 'nvme-EXAMPLE', },);
 ```
 */
export async function confirmPhrase({ explanation, phrase, }: {
  readonly explanation: string;
  readonly phrase: string;
},): Promise<void> {
  await show(`${explanation}\nType ${phrase} to continue: `,);
  const line = await readVisibleLine();
  if (line !== phrase) {
    throw new PromptDeclinedError('confirmation did not match',);
  }
}
