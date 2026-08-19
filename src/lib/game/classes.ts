// The classes' primary colours, mirrored from wowsims-mop's `ui/core/player_classes/*.ts`
// (`hexColor` on each class). They are the identity of a spec's report: a spec derives its own
// scheme from its class's colour, so a Windwalker report and an Elemental report are recognisable
// at a glance and a reader never has to ask which class a section is arguing about.
//
// Only the classes this app ships are listed; a new spec adds its class's line from the same file,
// which is where the value is decided. `CLASS_COLOR.monk` above comes from `player_classes/monk.ts`
// and `shaman` from `player_classes/shaman.ts` — the spec module reads them here rather than
// carrying its own copy.

/** The classes this app ships, keyed by the registry's own class key. */
export const CLASS_COLOR = {
	// wowsims-mop ui/core/player_classes/monk.ts — `Monk.hexColor`.
	monk: '#00ff98',
	// wowsims-mop ui/core/player_classes/shaman.ts — `Shaman.hexColor`.
	shaman: '#2459ff',
} as const satisfies Record<string, string>;

/**
 * A spec's report palette: the colours its sections draw in.
 *
 * Every accent is derived from the class's primary colour (the washes are the standard
 * `color-mix`es the charts already apply), so a spec declares the identity and the charts derive
 * the rest.
 */
export interface SpecColors {
	/** The class's primary colour, as the sim defines it — the line of every bar this spec draws. */
	primary: string;
}
