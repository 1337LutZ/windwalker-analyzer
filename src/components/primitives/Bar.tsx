const BAR_TONE = {
	kick: 'bg-kick',
	rune: 'bg-rune',
	brew: 'bg-brew/60',
	miss: 'bg-miss',
	muted: 'bg-muted/50',
} as const;

export type BarTone = keyof typeof BAR_TONE;

/**
 * Decorative by design: every bar in this app sits next to the number it encodes, so announcing it
 * again would only make the row longer to listen to.
 *
 * That is also why this is not a Base UI `Meter`, which is otherwise the exact primitive for it. A
 * meter announces its own value, and the value here is a share of the largest row rather than a
 * quantity — "43 percent" next to a cell that already said "7.4 cpm" is noise, and misleading noise
 * at that. Nothing about it is focusable or keyboard-operable, so there is nothing else to inherit.
 */
export default function Bar({ pct, tone }: { pct: number; tone: BarTone }) {
	return (
		<div className="h-[9px] w-full rounded-sm bg-track" aria-hidden="true">
			<div className={`h-[9px] rounded-r-sm ${BAR_TONE[tone]}`} style={{ width: `${Math.max(pct, 1)}%` }} />
		</div>
	);
}
