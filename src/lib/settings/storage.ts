// Where the analysis settings live between visits.
//
// `localStorage`, like the client id and unlike the token: these are preferences, not credentials,
// and asking someone to re-enter their own latency every tab would be absurd. Nothing here is sent
// anywhere — the settings only ever reach the analysis engine running in this tab.

import { defaultSettings, normaliseSettings, type AnalysisSettings, type SettingSchema } from './model';

const KEY = 'wcl.settings';

export function readSettings(schema: SettingSchema[]): AnalysisSettings {
	try {
		const raw = localStorage.getItem(KEY);
		return raw === null ? defaultSettings(schema) : normaliseSettings(JSON.parse(raw), schema);
	} catch {
		// A malformed or unreadable entry is not worth failing a report over; the defaults are correct
		// for most people and the settings panel will show what is actually in force.
		return defaultSettings(schema);
	}
}

// Guarded for the same reason the read is, and it matters more: the write runs inside a click
// handler. `setItem` throws on a full quota and in an origin where storage is blocked outright, and
// an exception out of an event handler takes the React tree down with it — so a browser that will
// not remember a preference costs the preference, not the report.
export function writeSettings(settings: AnalysisSettings): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(settings));
	} catch {
		// Not remembered between visits; still in force for this one.
	}
}

export function clearSettings(): void {
	try {
		localStorage.removeItem(KEY);
	} catch {
		// Nothing stored, or nothing storable. Either way there is nothing left to clear.
	}
}
