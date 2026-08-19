// The analysis settings, as React state backed by `localStorage`.
//
// One hook rather than a context: the settings are read in exactly one place — `ReportFlow`, which
// owns the analysis — and passed down as an ordinary prop. A context here would add a provider and a
// re-render boundary to save threading one value through one component.

import { useCallback, useEffect, useState } from 'react';

import type { AnalysisSettings, SettingSchema } from '~/lib/settings';
import { defaultSettings, readSettings, writeSettings } from '~/lib/settings';

export interface SettingsState {
	settings: AnalysisSettings;
	save: (next: AnalysisSettings) => void;
	reset: () => void;
	/** The spec's declared thresholds, for the panel to render. */
	schema: SettingSchema[];
}

export function useSettings(schema: SettingSchema[]): SettingsState {
	// Not a lazy initialiser: `localStorage` does not exist while Astro prerenders this island, and
	// the first client render has to match the server's or React discards the tree.
	const [settings, setSettings] = useState<AnalysisSettings>(() => defaultSettings(schema));

	useEffect(() => setSettings(readSettings(schema)), [schema]);

	const save = useCallback((next: AnalysisSettings) => {
		writeSettings(next);
		setSettings(next);
	}, []);

	const reset = useCallback(() => {
		writeSettings(defaultSettings(schema));
		setSettings(defaultSettings(schema));
	}, [schema]);

	return { settings, save, reset, schema };
}
