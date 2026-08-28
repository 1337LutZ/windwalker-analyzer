// The pull played back: where the player stood, what they were trading with, and the target mode the
// report is grading that instant under.
//
// **Why it sits behind a button.** "What you were fighting" answers how many enemies were up and what
// that made the rotation, and for most pulls that is the whole answer. It is the add fights where it is
// not: a reader looking at 56 seconds of `aoe` on Galakras cannot tell from the strip whether the player
// was in the pack or seventy yards up a tower, and those are opposite readings of the same bar. That is a
// second question, asked by some readers on some pulls, which is what a dialog is for — the strip keeps
// its one row and the geometry is one press away rather than a second chart nobody asked for.
//
// **The mode readout is the point of putting it here.** The dot moving is interesting; the dot moving
// while a chip says `AOE` and the reader can see one body on screen is a finding. So the current
// segment's label is on the frame at all times, read out of `analysis.segments` rather than recomputed —
// `segments.ts` is the one reading of what the rotation should have been and this may not become a
// second one.
//
// Nothing here grades. There is no range ring and no distance verdict: a coordinate pair knows nothing
// about the wall between two actors, which `UNITS_PER_YARD` states where the scale is defined.

import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { useTranslation } from 'react-i18next';

import type { FightSegment } from '~/lib/analysis/segments';
import type { Analysis } from '~/lib/types';

import { COUNT } from '../charts/tones';
import { DialogShell, StatTiles } from '../primitives';
import { buttonClass } from '../primitives/controls';
import { KEY_ORDER } from './segmentCopy';

/**
 * The long side of the drawing, in view units. The short side follows the pull's own shape.
 *
 * A square box was the first draft and it is wrong for most pulls: the box a fight happens in is
 * whatever shape the room is, and Dark Shaman's corridor is 246 yards down and 107 across. Drawn
 * square, five sixths of the picture is empty and the part a reader came for is a thin band up the
 * middle. So the *viewBox* takes the bounds' aspect and the element inherits it — no `aspect-square`,
 * no letterboxing, and the drawing is as wide as the room was.
 */
const VIEW_LONG = 520;
/**
 * How far from square the box is allowed to get.
 *
 * A pull that never left one spot has a bounding box a few yards across and an aspect that is noise
 * rather than shape; unclamped it draws as a 3px-tall sliver. Past 2.5:1 the extra ratio buys nothing
 * a reader can use, and what it costs is the short axis becoming unreadable — so the box stops there
 * and the scale below letterboxes the remainder, which is honest: the empty margin is real space.
 */
const MAX_ASPECT = 2.5;
/** Room for the scale bar and the outermost dot, in view units. */
const PAD = 26;
/** How fast playback runs, in real ms per frame. Roughly 12× — a seven-minute pull in about 35 seconds. */
const TICK_MS = 80;

/**
 * The segment covering a moment, or undefined before the first and after the last.
 *
 * A linear scan rather than a binary search on purpose: a pull's timeline is at most a few dozen
 * segments, and the cut is `[startMs, endMs)` — half-open, as `FightSegment` declares — which a
 * hand-rolled bisection gets wrong at exactly the boundary a scrubber lands on.
 */
function segmentAt(segments: readonly FightSegment[], ms: number): FightSegment | undefined {
	return segments.find((s) => ms >= s.startMs && ms < s.endMs) ?? segments[segments.length - 1];
}

/**
 * The replay itself — drawn only when the analysis carried a track.
 *
 * Split from the trigger below so the dialog's content mounts with the dialog: a pull is up to seven
 * hundred frames of geometry and there is no reason to lay any of it out for a reader who never opens
 * this.
 */
function ReplayStage({ analysis }: { analysis: Analysis }) {
	const { t } = useTranslation('report');
	const replay = analysis.replay;
	const segments = analysis.segments?.segments ?? [];
	const [frame, setFrame] = useState(0);
	const [playing, setPlaying] = useState(false);
	const timer = useRef<ReturnType<typeof setInterval> | null>(null);

	const frames = replay?.frames ?? [];
	const last = Math.max(0, frames.length - 1);

	// Playback is an interval rather than rAF: the track is sampled at a fixed second and the frames
	// are what is being stepped through, so there is no sub-frame state for a smoother clock to buy.
	useEffect(() => {
		if (!playing) return;
		timer.current = setInterval(() => {
			setFrame((f) => {
				if (f >= last) return f;
				return f + 1;
			});
		}, TICK_MS);
		return () => {
			if (timer.current !== null) clearInterval(timer.current);
			timer.current = null;
		};
	}, [playing, last]);

	useEffect(() => {
		if (frame >= last) setPlaying(false);
	}, [frame, last]);

	const projected = useMemo(() => {
		if (replay === undefined) return null;
		const { minX, maxX, minY, maxY } = replay.bounds;
		const spanX = Math.max(1, maxX - minX);
		const spanY = Math.max(1, maxY - minY);

		// The box takes the room's shape, clamped so a pull that barely moved does not draw as a sliver.
		const aspect = Math.min(MAX_ASPECT, Math.max(1 / MAX_ASPECT, spanX / spanY));
		const w = aspect >= 1 ? VIEW_LONG : VIEW_LONG * aspect;
		const h = aspect >= 1 ? VIEW_LONG / aspect : VIEW_LONG;

		// **One scale for both axes, always.** Stretching each independently would fill the box exactly
		// and make a yard across mean something different from a yard down — every distance on the
		// drawing would then be a different lie depending on which way it ran.
		const scale = Math.min((w - PAD * 2) / spanX, (h - PAD * 2) / spanY);
		const offX = (w - spanX * scale) / 2;
		const offY = (h - spanY * scale) / 2;
		return {
			w,
			h,
			scale,
			// Screen y grows downward and map y grows northward, so the vertical is flipped here and
			// nowhere else — a drawing that forgot it renders the room upside down and still looks fine.
			px: (x: number) => offX + (x - minX) * scale,
			py: (y: number) => h - (offY + (y - minY) * scale),
		};
	}, [replay]);

	if (replay === undefined || projected === null || frames.length === 0) {
		return <p className="m-0 text-sm leading-relaxed text-muted">{t('summary.shape.replay.missing')}</p>;
	}

	const here = frames[Math.min(frame, last)];
	if (here === undefined) return null;
	const segment = segmentAt(segments, here.ms);
	const present = KEY_ORDER.filter((mode) => segments.some((s) => s.mode === mode));
	const fraction = last > 0 ? Math.min(frame, last) / last : 0;
	const grid = 20 * projected.scale;

	return (
		<div className="flex flex-col gap-3">
			<svg
				viewBox={`0 0 ${projected.w} ${projected.h}`}
				style={{
					maxWidth: `min(100%, calc((100dvh - 16.5rem) * ${(projected.w / projected.h).toFixed(3)}))`,
				}}
				className="mx-auto block h-auto w-full rounded-sm bg-track"
				role="img"
				aria-label={t('summary.shape.replay.chartLabel')}
			>
				{/* A 20-yard grid, so a reader can measure a gap without a ruler. */}
				{Array.from({ length: Math.ceil(projected.w / grid) + 1 }, (_, i) => i * grid).map((at) => (
					<line key={`v${at}`} x1={at} y1={0} x2={at} y2={projected.h} className="stroke-line" strokeWidth={1} />
				))}
				{Array.from({ length: Math.ceil(projected.h / grid) + 1 }, (_, i) => i * grid).map((at) => (
					<line key={`h${at}`} x1={0} y1={at} x2={projected.w} y2={at} className="stroke-line" strokeWidth={1} />
				))}
				{here.foes.map((foe) => (
					<rect
						key={foe.key}
						x={projected.px(foe.x) - 3.6}
						y={projected.py(foe.y) - 3.6}
						width={7.2}
						height={7.2}
						transform={`rotate(45 ${projected.px(foe.x)} ${projected.py(foe.y)})`}
						className="fill-ink-2"
						opacity={0.65}
					>
						{/* `<title>` rather than a hover handler and a floating div: the browser's own tooltip is
						    what a screen reader reads as the shape's accessible name, so one element answers both
						    the pointer and the reader. A body the actor table did not name falls back to its key,
						    which is at least something to match against the log. */}
						<title>{foe.name === '' ? foe.key : foe.name}</title>
					</rect>
				))}
				{here.self !== null ? (
					<circle
						cx={projected.px(here.self[0])}
						cy={projected.py(here.self[1])}
						r={6}
						className="fill-kick stroke-track"
						strokeWidth={2}
					>
						<title>{t('summary.shape.replay.you')}</title>
					</circle>
				) : null}
				<line
					x1={16}
					y1={projected.h - 18}
					x2={16 + grid}
					y2={projected.h - 18}
					className="stroke-muted"
					strokeWidth={2}
				/>
				<text x={16 + grid + 7} y={projected.h - 14} className="fill-muted font-mono" fontSize={11}>
					{t('summary.shape.replay.scale')}
				</text>
			</svg>

			<div className="flex items-center gap-3" style={{ '--range-fraction': fraction } as CSSProperties}>
				<button
					type="button"
					onClick={() => setPlaying((p) => !p)}
					className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-line bg-raised text-kick transition-colors hover:bg-line"
					aria-label={t(playing ? 'summary.shape.replay.pause' : 'summary.shape.replay.play')}
				>
					{playing ? '⏸' : '▶'}
				</button>
				{/* **The pull's own shape, behind the handle that moves along it.**
				    The bar was a plain two-tone track, which left the reader holding the mode strip above in
				    their head while dragging. Drawn behind it, the segments answer "when does the aoe part
				    start" without a scrub at all, and the played half is the same picture at full strength.
				    So the slider's own track goes transparent — `--range-track` — and this shows through.

				    `--range-fraction` sits on the row rather than the input because both of them read it:
				    WebKit has no pseudo-element for a slider's filled half, so `global.css` works the fill's
				    stop out from this, and the dimming below has to land on exactly the same place. A
				    fraction and not a percentage, because neither stop is one — the thumb travels
				    `track - thumb`. */}
				<div className="relative flex-1">
					<div
						aria-hidden="true"
						className="pointer-events-none absolute inset-x-0 top-1/2 flex h-2.5 -translate-y-1/2 overflow-hidden rounded-sm border border-line"
					>
						{segments.map((s) => (
							<span
								key={s.index}
								className={COUNT[s.mode].fill}
								style={{ flexGrow: s.endMs - s.startMs, flexBasis: 0 }}
							/>
						))}
						{/* Everything still to come, knocked back. Its edge is placed on the thumb's travel and
						    not on a flat percentage of the bar, so it stays under the handle at both ends. */}
						<span
							className="absolute inset-y-0 right-0 bg-bg/55"
							style={{
								left: 'calc(var(--range-thumb) / 2 + (100% - var(--range-thumb)) * var(--range-fraction, 0))',
							}}
						/>
					</div>
					<input
						type="range"
						min={0}
						max={last}
						value={Math.min(frame, last)}
						onChange={(e) => {
							setPlaying(false);
							setFrame(Number(e.target.value));
						}}
						style={{ '--range-track': 'transparent' } as CSSProperties}
						className="relative w-full"
						aria-label={t('summary.shape.replay.scrub')}
					/>
				</div>
				{/* Beside the bar it belongs to, rather than up beside the mode strip. It is a readout of
				    where the handle is, so it reads with the handle; at the top of the dialog it was a second
				    number competing with the one thing that row is for. `tabular-nums` and a floor width keep
				    the controls from shuffling sideways as the digits change. */}
				<span className="min-w-[6.5rem] shrink-0 text-right font-mono text-xs text-muted tabular-nums">
					{/* `at` is the frame's own millisecond and `of` is the pull's, so the total is the real
					    length rather than the last whole second the track happens to be sampled on.
					    `clockFixed` rather than `stamp`: the track is sampled once a second, so three
					    fractional digits here would be three zeroes on every frame — a precision the readout
					    would be claiming and the data does not have. The padding is what it is here for,
					    since this string changes while the reader drags. */}
					{t('summary.shape.replay.clock', { at: here.ms, of: analysis.durationMs })}
				</span>
			</div>

			<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
				{/* **The whole scale, with this moment's reading lit** — not one chip that rewrites itself.
				    A label that changes as the scrubber moves makes the reader read before they can compare;
				    a fixed row lets them see at a glance that the pull has an aoe reading at all and watch it
				    arrive. It is the chart key from the strip behind this dialog, in the same order and with
				    the same words, so the two cannot come to disagree about what the modes are called.

				    `present` rather than all five, which is the rule `SegmentStrip` already applies to its
				    key: a swatch for a bar the reader cannot find is a swatch they go looking for. */}
				<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
					<span className="font-mono text-xs tracking-[0.14em] text-muted uppercase">
						{t('summary.shape.replay.modeLabel')}
					</span>
					{/* One block divided into cells, not a row of chips. These are readings of a single scale
					    and a set of separately-bordered pills reads as a set of buttons to press — which is
					    exactly wrong for a readout nothing here can change. `StatTiles` is where that
					    construction lives; `strip` is its label-sized layout. */}
					<StatTiles layout="strip">
						{present.map((mode) => {
							const on = segment?.mode === mode;
							const tone = COUNT[mode];
							return (
								<span
									key={mode}
									// The live one is announced as the current item of the set rather than by its
									// colour alone, which is the same reason the bars on the strip carry their count
									// as text.
									aria-current={on ? 'true' : undefined}
									className={`px-2.5 py-1 font-mono text-xs ${
										on ? `font-semibold ${tone.fill} ${tone.ink}` : 'bg-surface font-medium text-muted'
									}`}
								>
									{t('summary.shape.row', { context: mode })}
								</span>
							);
						})}
					</StatTiles>
				</div>
			</div>

			{/* The height is capped against the viewport and the width follows from it, so the drawing grows
			    into the screen without ever pushing its own mode chip off the top — which is the one readout
			    it exists to carry. The 16.5rem is what the dialog spends on everything that is not the drawing:
			    the title row, the mode readout, the controls and the note, measured at the width where they
			    each take two lines. `maxWidth` is computed rather than a class because the ratio is the
			    pull's, not a value Tailwind could know. */}
			<p className="m-0 text-sm leading-relaxed text-muted">{t('summary.shape.replay.note')}</p>
		</div>
	);
}

/**
 * The button and the dialog around it.
 *
 * Renders nothing at all when the analysis carried no track — an old capture, or a pull whose stream had
 * no resource block. A control that opens an empty dialog is worse than no control, and `Analysis.replay`
 * is optional precisely because both of those are ordinary.
 */
export default function FightReplay({ analysis }: { analysis: Analysis }) {
	const { t } = useTranslation('report');
	if (analysis.replay === undefined) return null;

	return (
		<DialogShell
			width="full"
			closeLabel={t('summary.shape.replay.close')}
			trigger={
				<Dialog.Trigger className={`self-start ${buttonClass}`}>{t('summary.shape.replay.open')}</Dialog.Trigger>
			}
			title={t('summary.shape.replay.title')}
			description={t('summary.shape.replay.description')}
		>
			<ReplayStage analysis={analysis} />
		</DialogShell>
	);
}
