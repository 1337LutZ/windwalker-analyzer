import { useReportCopy } from '~/hooks/useReportCopy';
import type { Analysis } from '~/lib/types';

import { DataGrid, Note, Pill, Prose, Section, SpellIcon, type GridRow } from '../primitives';

/**
 * One entry of the priority list.
 *
 * The order is a decision and lives here; the words are copy and live in `locales/en/report.json`
 * under `rotation.entry.<key>`. Splitting them that way is what stops a reordering from turning into
 * a rewrite, and it keeps this file free of the prose the house rules put in one place.
 *
 * `id` is the ability's *cast* id — the same one `spec/windwalker.ts` declares and the cast table
 * keys on — so the icon beside a name is the icon beside that name everywhere else on the page.
 */
interface Entry {
	key: string;
	id: number;
}

/**
 * One target, in the order the sim's priority list evaluates.
 *
 * Transcribed from `ui/monk/windwalker/apls/default.apl.json`, whose 32 entries are numbered in the
 * comments below. It is *one* list, not two: everything in `MULTI_TARGET` is the same file with a
 * `numberTargets` test that cannot be true at one enemy, which is why those entries are absent here
 * rather than contradicted.
 *
 * Four kinds of entry are deliberately dropped, because none of them is a rotation decision a reader
 * can act on: the elixir and weapon swap groups (1, 2, 7, 8), which model a sim-only optimisation;
 * the Chi Sphere pickup and the Arcane Torrent chi return (9, 11); the tier-15 energy sphere (14);
 * and the potion, trinket and racial group (6), which the list fires under a running brew. The two
 * alternatives to Chi Wave on its talent row — Zen Sphere (26, 30) and Chi Burst (28) — are dropped
 * for a different reason: they occupy the same slot in the same order, so listing three buttons for
 * one choice would triple a row without adding a decision.
 */
const SINGLE_TARGET: readonly Entry[] = [
	{ key: 'touchOfDeath', id: 115080 }, // 3
	{ key: 'chiBrew', id: 115399 }, // 10
	{ key: 'tigereyeBrew', id: 1247275 }, // 12, 13
	{ key: 'energizingBrew', id: 115288 }, // 15
	{ key: 'invokeXuen', id: 123904 }, // 16, via the unconditional autocast
	{ key: 'risingSunKick', id: 107428 }, // 18
	{ key: 'tigerPalmRefresh', id: 100787 }, // 19
	{ key: 'chiWave', id: 115098 }, // 23
	{ key: 'comboBreakerKick', id: 100784 }, // 24
	{ key: 'fistsOfFury', id: 113656 }, // 25
	{ key: 'tigerPalmProc', id: 100787 }, // 27
	{ key: 'jab', id: 100780 }, // 29
	{ key: 'rushingJadeWind', id: 116847 }, // 31
	{ key: 'blackoutKick', id: 100784 }, // 32
];

/**
 * What changes once there is more than one enemy, and at what count.
 *
 * Not a second rotation — the same list with four target tests firing. Ordered by the count that
 * switches each one on rather than by priority, which is the opposite of the table above and is
 * deliberate: a reader arrives here holding a number of enemies, not a position in a list.
 */
const MULTI_TARGET: readonly Entry[] = [
	{ key: 'stormEarthAndFire', id: 138228 }, // 5
	{ key: 'rushingJadeWindMulti', id: 116847 }, // 17
	{ key: 'spinningCraneKick', id: 101546 }, // 22
	{ key: 'blackoutKickDump', id: 100784 }, // 32, the 105-energy branch
	{ key: 'craneOverKick', id: 101546 }, // 20
	{ key: 'risingSunKickMulti', id: 107428 }, // 18, 21
];

/**
 * The rotation itself: what to press, in what order, and what each condition is there to prevent.
 *
 * The one section on the page that grades nothing. Every other section says what happened in this
 * pull; this one says what the pull was being measured against, so a reader who has just been told
 * their Tigereye Brew averaged six stacks has somewhere to go and find out what ten would have taken.
 * It renders identically for every log — it takes `analysis` only to reach the copy, which is why
 * there is no empty state and no verdict below.
 *
 * It sits second to last, above the method and below everything that judges the pull, because it is
 * reference rather than argument.
 */
export default function Rotation({ analysis }: { analysis: Analysis }) {
	const { t } = useReportCopy(analysis);

	// Both tables are built the same way, so the shape is written once. The `when` cell is the
	// condition the priority list actually tests; `why` is what that condition is protecting, which is
	// the half a transcription of the APL leaves out and the half a reader needs.
	const rows = (entries: readonly Entry[]): GridRow[] =>
		entries.map((entry) => ({
			key: entry.key,
			cells: {
				button: (
					<span className="flex items-center gap-2">
						<SpellIcon id={entry.id} size="sm" />
						<span>{t(`rotation.entry.${entry.key}.name`)}</span>
					</span>
				),
				when: <span className="text-ink-2">{t(`rotation.entry.${entry.key}.when`)}</span>,
				why: <span className="text-muted">{t(`rotation.entry.${entry.key}.why`)}</span>,
			},
		}));

	// One set of columns for both tables. The condition column is the widest thing here, so the third
	// column folds to its own row on a phone rather than being squeezed opposite a label.
	const columns = [
		{ key: 'button', label: t('rotation.columns.button'), width: '190px' },
		{ key: 'when', label: t('rotation.columns.when') },
		{ key: 'why', label: t('rotation.columns.why'), card: 'wide' as const },
	];

	return (
		<Section id="rotation" title={t('rotation.title')}>
			<div className="flex flex-col gap-3.5">
				<Prose>{t('rotation.intent')}</Prose>
				<Prose>{t('rotation.economy')}</Prose>
			</div>

			<h3 className="m-0 mt-7 mb-3 font-mono text-sm font-semibold tracking-[0.1em] uppercase text-muted">
				{t('rotation.single.title')}
			</h3>
			<Prose>{t('rotation.single.intent')}</Prose>
			<div className="mt-4">
				<DataGrid
					caption={t('rotation.single.caption')}
					minWidth="680px"
					columns={columns}
					rows={rows(SINGLE_TARGET)}
				/>
			</div>

			<h3 className="m-0 mt-8 mb-3 font-mono text-sm font-semibold tracking-[0.1em] uppercase text-muted">
				{t('rotation.multi.title')}
			</h3>
			<Prose>{t('rotation.multi.intent')}</Prose>
			{/* The crossovers as pills rather than as a fourth column, because they are the answer to the
			    question this half of the section exists for — at how many does the button change — and a
			    reader scanning for "three" should find it without reading a table. */}
			<p className="m-0 mt-3.5">
				<Pill>{t('rotation.crossover.rjw')}</Pill>
				<Pill>{t('rotation.crossover.sef')}</Pill>
				<Pill>{t('rotation.crossover.sck')}</Pill>
				<Pill>{t('rotation.crossover.sckOverRsk')}</Pill>
			</p>
			<div className="mt-4">
				<DataGrid caption={t('rotation.multi.caption')} minWidth="680px" columns={columns} rows={rows(MULTI_TARGET)} />
			</div>

			{/* The five things a two-column table cannot carry: why the brew is spent where it is, why the
			    channel needs three conditions, why one kick matters to everyone, which talents the list
			    assumes, and one correction the spec's own name invites. Separate notes rather than a
			    closing paragraph, because a reader checking one should not have to read past four. */}
			<div className="mt-6 flex flex-col gap-2.5">
				<Note>{t('rotation.notes.snapshot')}</Note>
				<Note>{t('rotation.notes.channel')}</Note>
				<Note>{t('rotation.notes.debuff')}</Note>
				<Note>{t('rotation.notes.talents')}</Note>
				<Note>{t('rotation.notes.mastery')}</Note>
			</div>
		</Section>
	);
}
