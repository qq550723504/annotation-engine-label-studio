// Panel titles are persisted with layout state. Translate only on render so a
// locale change cannot rewrite or invalidate the saved panel layout.
const titleKeys: Record<string, string> = {
  regions: "panelRegions",
  history: "panelHistory",
  relations: "panelRelations",
  info: "panelInfo",
  comments: "panelComments",
};

export function displayPanelTitle(name: string, savedTitle: string, t: (key: string) => string): string {
  const key = titleKeys[name];
  return key ? t(key) : savedTitle;
}
