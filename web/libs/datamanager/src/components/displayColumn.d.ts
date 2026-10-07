type DisplayColumn = {
  target?: string;
  parent?: unknown;
  alias?: string;
  title?: string;
  help?: string;
};

export function displayColumnTitle(column: DisplayColumn | null | undefined, t: (key: string) => string): string | undefined;
export function displayColumnHelp(column: DisplayColumn | null | undefined, t: (key: string) => string): string | undefined;
