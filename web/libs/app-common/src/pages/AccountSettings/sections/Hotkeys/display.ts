import type { LocaleRuntime } from "@humansignal/i18n";
import { getTypedDefaultHotkeys, type Hotkey, type Section } from "./utils";

const defaults = new Map(getTypedDefaultHotkeys().map((hotkey) => [hotkey.id, hotkey]));
const sectionNames: Record<string, string> = {
  annotation: "Annotation",
  data_manager: "DataManager",
  regions: "Regions",
  tools: "Tools",
  audio: "Audio",
  video: "Video",
  timeseries: "Timeseries",
  image_gallery: "ImageGallery",
  paragraphs: "Paragraphs",
};

// Display translations are derived from stable default IDs. Persisted hotkey
// labels, descriptions, action IDs and key combinations are never rewritten.
export function displayHotkey(hotkey: Hotkey, runtime: LocaleRuntime): { label: string; description?: string } {
  const baseline = defaults.get(hotkey.id);
  return {
    label: baseline?.label === hotkey.label
      ? runtime.tDynamic(`app:hotkey${hotkey.id}Label`) : hotkey.label,
    description: baseline?.description === hotkey.description
      ? runtime.tDynamic(`app:hotkey${hotkey.id}Description`) : hotkey.description,
  };
}

export function displayHotkeySection(section: Section, runtime: LocaleRuntime): Section {
  const name = sectionNames[section.id];
  if (!name) return section;
  return {
    ...section,
    title: runtime.tDynamic(`app:hotkeySection${name}Title`),
    description: runtime.tDynamic(`app:hotkeySection${name}Description`),
  };
}
