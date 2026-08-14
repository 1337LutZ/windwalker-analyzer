// Where the analysis settings live between visits.
//
// `localStorage`, like the client id and unlike the token: these are preferences, not credentials,
// and asking someone to re-enter their own latency every tab would be absurd. Nothing here is sent
// anywhere — the settings only ever reach the analysis engine running in this tab.

import { DEFAULT_SETTINGS, normaliseSettings, type AnalysisSettings } from './model';

const KEY = 'wcl.settings';

export function readSettings(): AnalysisSettings {
	try {
		const raw = localStorage.getItem(KEY);
		return raw === null ? DEFAULT_SETTINGS : normaliseSettings(JSON.parse(raw));
	} catch {
		// A malformed or unreadable entry is not worth failing a report over; the defaults are correct
		// for most people and the settings panel will show what is actually in force.
		return DEFAULT_SETTINGS;
	}
}

export function writeSettings(settings: AnalysisSettings): void {
	localStorage.setItem(KEY, JSON.stringify(settings));
}

export function clearSettings(): void {
	localStorage.removeItem(KEY);
}
