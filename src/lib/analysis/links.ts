import { WCL_REPORT_BASE } from '~/lib/wcl/endpoint';

export interface LinkContext {
	code: string;
	fightID: number;
	sourceID: number;
	/** `fight.startTime`: deep links are report-relative, so it has to be added back. */
	fightStart: number;
	/** Padding either side of the moment being linked. */
	padMs?: number;
}

/**
 * A linker for one fight: fight-relative ms in, a WarcraftLogs URL out.
 *
 * This is what makes a finding checkable rather than a number to trust, so every miss carries one.
 * The host is the single one this analyser reads, imported rather than restated — a link to the
 * wrong subdomain lands on a report that does not exist there.
 */
export function makeLinker({
	code,
	fightID,
	sourceID,
	fightStart,
	padMs = 3000,
}: LinkContext): (atMs: number) => string {
	return (atMs) => {
		const start = Math.max(0, fightStart + atMs - padMs);
		const end = fightStart + atMs + padMs;
		// `type=damage-done&view=events` rather than the summary table WarcraftLogs opens by default.
		// Every finding here is about a moment — a button pressed late, held, or not pressed at all —
		// and only the event list shows what happened in the seconds either side of it. A table of
		// totals for the same window cannot answer the question the row is asking, however narrow the
		// window is cut.
		return `${WCL_REPORT_BASE}/${code}#fight=${fightID}&type=damage-done&view=events&source=${sourceID}&start=${start}&end=${end}`;
	};
}
