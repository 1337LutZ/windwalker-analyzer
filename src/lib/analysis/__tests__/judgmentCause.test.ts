// The cause tag: six words, and the promise that each one means the same thing everywhere it is drawn.
//
// Every ledger in this report answers "what happened" and none of them answered "whose was it". The tag
// is that answer, and it is only worth anything while three things hold: the vocabulary is closed, each
// tag carries the fix it asks of the reader, and the tag on a row agrees with the tint that row already
// had.
//
// The tint is the interesting one. `GridRow.band` says *this fault was charged against you* and the tag
// says *whose it was*; they are two readings of one flag today, and the day they stop agreeing a reader
// meets a red row tagged `Rotation` and has to decide which half of the page to believe.
//
// Here rather than beside a spec, because the vocabulary is shared: a Windwalker row and an Elemental
// row are tagged out of the same six. `laneApplications.test.ts` next door sweeps every spec for the
// same reason.
import { describe, expect, it } from 'vitest';

import { rawFixtures } from '~/lib/analysis/fixtures';
import i18n, { initI18n } from '~/lib/i18n/config';
import { getSpec } from '~/lib/spec';
import type { Analysis, ElementalAuditResult, JudgmentCause } from '~/lib/types';

initI18n();
const t = i18n.getFixedT('en', 'report');

/** The vocabulary, written out so a tag added to the union with no copy fails here and not at a reader. */
const CAUSES: readonly JudgmentCause[] = ['player', 'rotation', 'fight', 'log', 'raid', 'build'];

const PULLS = rawFixtures('elemental').map(
	({ name, dataset }) => [name, getSpec('elemental')!.analyse(dataset) as Analysis & ElementalAuditResult] as const,
);

describe('the cause vocabulary', () => {
	it('gives every tag a label and the fix it asks for', () => {
		for (const cause of CAUSES) {
			for (const part of ['label', 'takeaway']) {
				const key = `cause.${cause}.${part}`;
				expect(t(key), key).not.toBe(key);
				expect(t(key).length, key).toBeGreaterThan(2);
			}
		}
	});

	/**
	 * `raid` is an action and not an excuse, which is the whole reason it is not folded into `fight`. A
	 * takeaway that told the reader to shrug would make the one row on the page they can fix by talking
	 * read like the rows nobody can fix.
	 */
	it('asks the raid tag for a conversation rather than a shrug', () => {
		expect(t('cause.raid.takeaway').toLowerCase()).toContain('communicate');
	});
});

describe('the tag and the tint say the same thing', () => {
	/**
	 * Only a wasted surge is drawn as a judgment, so only a wasted surge carries a tag: a proc that was
	 * spent needs no row, and one the fight took back was never on offer.
	 */
	it('tags every drawn Lava Surge row and nothing else', () => {
		for (const [name, el] of PULLS) {
			for (const proc of el.lavaBurst.procs) {
				expect(proc.cause !== undefined, `${name} @${proc.start}`).toBe(proc.wasted);
				if (proc.cause !== undefined) expect(CAUSES, name).toContain(proc.cause);
			}
		}
	});

	/**
	 * The pairing this file exists for. `judged` decides the tint and the charge alike, so a `player` tag
	 * is exactly a charged row and a `rotation` tag is exactly a forgiven one.
	 */
	it('reads player on the charged surges and rotation on the forgiven ones', () => {
		for (const [name, el] of PULLS) {
			for (const proc of el.lavaBurst.procs.filter((p) => p.wasted)) {
				expect(proc.cause, `${name} @${proc.start}`).toBe(proc.judged ? 'player' : 'rotation');
			}
		}
		// Non-vacuity, and the committed set is what supplies it: `cleave` charges three surges and
		// `addsThenBoss` forgives five, so both arms are exercised rather than one.
		const drawn = PULLS.flatMap(([, el]) => el.lavaBurst.procs.map((proc) => proc.cause).filter(Boolean));
		expect(drawn.filter((cause) => cause === 'player').length).toBeGreaterThan(0);
		expect(drawn.filter((cause) => cause === 'rotation').length).toBeGreaterThan(0);
	});

	/** The charge the scorecard grades is the count of `player` tags, on every committed pull. */
	it('counts the same faults the scorecard charges', () => {
		for (const [name, el] of PULLS) {
			const tagged = el.lavaBurst.procs.filter((proc) => proc.cause === 'player').length;
			expect(tagged, name).toBe(el.lavaBurst.wastedJudged);
		}
	});
});
