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

import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { useTranslation } from 'react-i18next';

import type { FightSegment } from '~/lib/analysis/segments';
import type { Analysis } from '~/lib/types';

import { COUNT } from '../charts/tones';
import { DialogShell } from '../primitives';
import { segmentLabel } from './segmentCopy';

/** The drawing's own box. Square, because a room is not a timeline and a wide one wastes both axes. */
const VIEW = 460;
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
		const scale = (VIEW - PAD * 2) / Math.max(spanX, spanY);
		const offX = (VIEW - spanX * scale) / 2;
		const offY = (VIEW - spanY * scale) / 2;
		return {
			scale,
			// Screen y grows downward and map y grows northward, so the vertical is flipped here and
			// nowhere else — a drawing that forgot it renders the room upside down and still looks fine.
			px: (x: number) => offX + (x - minX) * scale,
			py: (y: number) => VIEW - (offY + (y - minY) * scale),
		};
	}, [replay]);

	if (replay === undefined || projected === null || frames.length === 0) {
		return <p className="m-0 text-sm leading-relaxed text-muted">{t('summary.shape.replay.missing')}</p>;
	}

	const here = frames[Math.min(frame, last)];
	if (here === undefined) return null;
	const segment = segmentAt(segments, here.ms);
	const tone = segment === undefined ? COUNT.idle : COUNT[segment.mode];
	const seconds = Math.round(here.ms / 1000);
	const grid = 20 * projected.scale;

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
				{/* The mode on the frame, not only in the strip behind the dialog. This is the readout the
				    replay exists to carry: what the report is grading this instant as, while the reader can
				    see how many bodies were actually in front of the player. */}
				<span className="flex items-center gap-2">
					<span className="font-mono text-xs tracking-[0.14em] text-muted uppercase">
						{t('summary.shape.replay.modeLabel')}
					</span>
					<span className={`rounded-sm px-2 py-[3px] font-mono text-xs font-semibold ${tone.fill} ${tone.ink}`}>
						{segment === undefined ? t('summary.shape.row', { context: 'idle' }) : segmentLabel(segment, t)}
					</span>
				</span>
				<span className="font-mono text-xs text-muted tabular-nums">
					{t('summary.shape.replay.clock', {
						at: seconds,
						of: Math.round(((replay.frames.length - 1) * replay.stepMs) / 1000),
					})}
				</span>
			</div>

			{/* Square, and capped against the viewport rather than the dialog's width. At `table` width the
			    drawing would otherwise be 52rem tall and push its own mode chip off the top of the screen,
			    which is the one readout it exists to carry. */}
			<svg
				viewBox={`0 0 ${VIEW} ${VIEW}`}
				className="mx-auto block aspect-square w-full max-w-[min(100%,46vh)] rounded-sm bg-track"
				role="img"
				aria-label={t('summary.shape.replay.chartLabel')}
			>
				{/* A 20-yard grid, so a reader can measure a gap without a ruler. */}
				{Array.from({ length: Math.ceil(VIEW / grid) + 1 }, (_, i) => i * grid).map((at) => (
					<g key={at}>
						<line x1={at} y1={0} x2={at} y2={VIEW} className="stroke-line" strokeWidth={1} />
						<line x1={0} y1={at} x2={VIEW} y2={at} className="stroke-line" strokeWidth={1} />
					</g>
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
					/>
				))}
				{here.self !== null ? (
					<circle
						cx={projected.px(here.self[0])}
						cy={projected.py(here.self[1])}
						r={6}
						className="fill-kick stroke-track"
						strokeWidth={2}
					/>
				) : null}
				<line x1={16} y1={VIEW - 18} x2={16 + grid} y2={VIEW - 18} className="stroke-muted" strokeWidth={2} />
				<text x={16 + grid + 7} y={VIEW - 14} className="fill-muted font-mono" fontSize={11}>
					{t('summary.shape.replay.scale')}
				</text>
			</svg>

			<div className="flex items-center gap-3">
				<button
					type="button"
					onClick={() => setPlaying((p) => !p)}
					className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-line bg-raised text-ink"
					aria-label={t(playing ? 'summary.shape.replay.pause' : 'summary.shape.replay.play')}
				>
					{playing ? '⏸' : '▶'}
				</button>
				<input
					type="range"
					min={0}
					max={last}
					value={Math.min(frame, last)}
					onChange={(e) => {
						setPlaying(false);
						setFrame(Number(e.target.value));
					}}
					className="w-full"
					aria-label={t('summary.shape.replay.scrub')}
				/>
			</div>

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
			width="table"
			trigger={
				<Dialog.Trigger className="rounded-sm border border-line bg-raised px-2.5 py-1 font-mono text-xs font-semibold tracking-[0.1em] text-ink-2 uppercase transition-colors hover:text-ink">
					{t('summary.shape.replay.open')}
				</Dialog.Trigger>
			}
			title={t('summary.shape.replay.title')}
			description={t('summary.shape.replay.description')}
		>
			<ReplayStage analysis={analysis} />
		</DialogShell>
	);
}
