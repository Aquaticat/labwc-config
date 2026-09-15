/**
 Chooses where full-screen screenshots are saved.

 Kept free of runtime imports so it is unit-tested under Deno and bundled for QuickJS-ng.

 @module
 */

/**
 Resolves the pictures directory from `~/.config/user-dirs.dirs`.

 @param userDirs - text of `user-dirs.dirs`, or `undefined` when the file is missing
 @param home - the user's home directory
 @returns an absolute directory path
 */
export function picturesDirectory({ userDirs, home, }: { readonly userDirs: string | undefined; readonly home: string; },): string {
  const fallback = `${home}/Pictures`;
  const assignment = userDirs
    ?.split('\n',)
    .map((line,) => line.trim())
    .find((line,) => line.startsWith('XDG_PICTURES_DIR=',));
  if (assignment === undefined) {
    return fallback;
  }
  const quoted = assignment.slice('XDG_PICTURES_DIR='.length,);
  const value = quoted.startsWith('"',) && quoted.endsWith('"',) ? quoted.slice(1, -1,) : quoted;
  const expanded = value.startsWith('$HOME',) ? `${home}${value.slice('$HOME'.length,)}` : value;
  // xdg-user-dirs treats "$HOME/" as the directory being disabled, and relative paths are invalid.
  if (!expanded.startsWith('/',) || expanded.replace(/\/+$/u, '',) === home) {
    return fallback;
  }
  return expanded.replace(/\/+$/u, '',);
}

/**
 Builds the screenshot file path.

 @param directory - directory to save into
 @param epochMilliseconds - capture time
 @returns `directory/screenshot-SECONDS.png`
 */
export function screenshotPath(
  { directory, epochMilliseconds, }: { readonly directory: string; readonly epochMilliseconds: number; },
): string {
  return `${directory}/screenshot-${Math.floor(epochMilliseconds / 1000,)}.png`;
}
