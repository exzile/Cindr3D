export interface SettingHelp {
  brief: string; // Short hover tooltip (50-80 chars)
  detailed: string; // Full description (paragraph)
  whenToChange?: string[];
  commonValues?: string[];
  relatedSettings?: string[];
  references?: string[];
  imageUrl?: string; // Optional image URL demonstrating the effect
}
