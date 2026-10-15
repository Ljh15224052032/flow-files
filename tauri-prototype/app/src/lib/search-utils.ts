import { UI_COPY } from "../localization";
import type { SearchDate, SearchKind, SearchProfile, SearchSize, UiLanguage } from "../types";

export function searchProfilesMatch(first: SearchProfile, second: SearchProfile) {
  return first.query.toLocaleLowerCase() === second.query.toLocaleLowerCase()
    && first.kind === second.kind
    && first.date === second.date
    && first.size === second.size;
}

export function searchProfileLabel(profile: SearchProfile, language: UiLanguage) {
  const text = UI_COPY[language];
  const parts: string[] = [];
  if (profile.query) parts.push(`“${profile.query}”`);
  const kindLabels: Record<SearchKind, string> = { all: text.anyType, folders: text.foldersOnly, images: text.images, documents: text.documents, videos: text.videos, audio: text.audio, archives: text.archives };
  const dateLabels: Record<SearchDate, string> = { any: text.anyDate, day: text.pastDay, week: text.pastWeek, month: text.pastMonth, year: text.pastYear };
  const sizeLabels: Record<SearchSize, string> = { any: text.anySize, small: text.smallFiles, medium: text.mediumFiles, large: text.largeFiles };
  if (profile.kind !== "all") parts.push(kindLabels[profile.kind]);
  if (profile.date !== "any") parts.push(dateLabels[profile.date]);
  if (profile.size !== "any") parts.push(sizeLabels[profile.size]);
  return parts.join(" · ") || text.searchFilters;
}
