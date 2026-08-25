import { useReportCopy } from '~/hooks/useReportCopy';
import { formatInteger, formatPercentValue, formatSeconds } from '~/lib/format';
import type { Analysis, ProtectionAudit } from '~/lib/types';

import { Note, Prose, Section, StatTile, StatTiles } from '~/components/primitives';

/**
 * Where the globals went, and which of them the fight took.
 *
 * The report's subject, and the reason this spec was worth porting: every other audit in this tree
 * counts idle time against a player, and every one of them is wrong for the seconds where the
 * encounter removed the buttons.
 *
 * **Three numbers side by side and none subtracted from another.** What the pull had room for, what
 * was pressed, and the gap split into the fight's share and the player's. Netting them produces one
 * figure that hides which kind of fault it describes — and it is the player's half that the scorecard
 * grades, because it is the only half anybody could have done something about.
 *
 * The denominator is measured rather than declared: `effectiveGcd` is the median gap this pull's own
 * presses left, which on a spec whose global moves with haste *is* the hasted global. Nothing here
 * needs the haste model; the cooldowns do.
 */
export default function Globals({ analysis }: { analysis: Analysis }) {
	const { globals } = analysis as Analysis & ProtectionAudit;
	const { t, toneOf } = useReportCopy(analysis);

	return (
		<Section id="globals" title={t('globals.title')}>
			<Prose>{t('globals.intent')}</Prose>

			<div className="mt-4.5">
				<StatTiles>
					<StatTile
						value={`${formatInteger(globals.pressed)}`}
						suffix={`/${formatInteger(globals.available)}`}
						label={t('globals.kpi.pressed')}
					/>
					{/* The graded one, and the only graded one: what was left when the fight's share came off. */}
					<StatTile
						value={formatPercentValue(globals.available > 0 ? (globals.missedFree / globals.available) * 100 : 0)}
						label={t('globals.kpi.missedFree')}
						grade={toneOf('globalsMissed')}
					/>
					{/* Uncoloured on purpose. A fight that stuns you is not something you did. */}
					<StatTile value={`${formatInteger(globals.enforcedGlobals)}`} label={t('globals.kpi.enforced')} />
					<StatTile value={formatSeconds(globals.gcdMs)} label={t('globals.kpi.gcd')} />
				</StatTiles>
			</div>

			<div className="mt-5 flex flex-col gap-3.5">
				<Prose>
					{t('globals.summary', {
						available: globals.available,
						pressed: globals.pressed,
						missed: globals.missed,
						enforced: globals.enforcedGlobals,
						free: globals.missedFree,
					})}
				</Prose>
				{globals.enforcedGlobals > 0 ? <Note>{t('globals.enforcedNote')}</Note> : null}
			</div>
		</Section>
	);
}
