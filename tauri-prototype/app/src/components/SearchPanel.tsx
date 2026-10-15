import { UI_COPY } from "../localization";
import type { SavedSearch, SearchDate, SearchHistoryItem, SearchKind, SearchProfile, SearchSize, UiLanguage } from "../types";
import { searchProfileLabel } from "../lib/search-utils";

type SearchPanelProps = {
  language: UiLanguage;
  query: string;
  kind: SearchKind;
  date: SearchDate;
  size: SearchSize;
  savedSearches: SavedSearch[];
  searchHistory: SearchHistoryItem[];
  onKindChange: (kind: SearchKind) => void;
  onDateChange: (date: SearchDate) => void;
  onSizeChange: (size: SearchSize) => void;
  onSave: () => void;
  onStart: (profile?: SearchProfile) => void;
  onRemoveSaved: (id: string) => void;
  onClearHistory: () => void;
};

export function SearchPanel({ language, query, kind, date, size, savedSearches, searchHistory, onKindChange, onDateChange, onSizeChange, onSave, onStart, onRemoveSaved, onClearHistory }: SearchPanelProps) {
  const text = UI_COPY[language];
  const canSave = !!query.trim() || kind !== "all" || date !== "any" || size !== "any";
  return <div className="search-panel">
    <strong>{text.searchFilters}</strong>
    <label><span>{text.type}</span><select value={kind} onChange={(event) => onKindChange(event.target.value as SearchKind)}><option value="all">{text.anyType}</option><option value="folders">{text.foldersOnly}</option><option value="images">{text.images}</option><option value="documents">{text.documents}</option><option value="videos">{text.videos}</option><option value="audio">{text.audio}</option><option value="archives">{text.archives}</option></select></label>
    <label><span>{text.modified}</span><select value={date} onChange={(event) => onDateChange(event.target.value as SearchDate)}><option value="any">{text.anyDate}</option><option value="day">{text.pastDay}</option><option value="week">{text.pastWeek}</option><option value="month">{text.pastMonth}</option><option value="year">{text.pastYear}</option></select></label>
    <label><span>{text.size}</span><select value={size} onChange={(event) => onSizeChange(event.target.value as SearchSize)}><option value="any">{text.anySize}</option><option value="small">{text.smallFiles}</option><option value="medium">{text.mediumFiles}</option><option value="large">{text.largeFiles}</option></select></label>
    <div className="search-panel-actions"><button disabled={!canSave} onClick={onSave}>{text.saveSearch}</button><button className="search-panel-run" onClick={() => onStart()}>{text.startSearch}</button></div>
    {savedSearches.length > 0 && <section className="search-quick-section"><header><span>{text.savedSearches}</span></header><div className="search-quick-list">{savedSearches.map((item) => <div className="search-quick-item" key={item.id}><button title={item.name} onClick={() => onStart(item)}>{item.name}</button><button aria-label={text.removeSavedSearch} title={text.removeSavedSearch} onClick={() => onRemoveSaved(item.id)}>×</button></div>)}</div></section>}
    <section className="search-quick-section"><header><span>{text.recentSearches}</span>{searchHistory.length > 0 && <button onClick={onClearHistory}>{text.clearHistory}</button>}</header>{searchHistory.length > 0 ? <div className="search-quick-list history">{searchHistory.map((item) => <button key={`${item.usedAt}-${item.query}-${item.kind}-${item.date}-${item.size}`} title={searchProfileLabel(item, language)} onClick={() => onStart(item)}>{searchProfileLabel(item, language)}</button>)}</div> : <small>{text.noSearchHistory}</small>}</section>
  </div>;
}
