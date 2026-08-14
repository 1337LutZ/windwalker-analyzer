import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Analysis } from '~/lib/types';

const fixture = (name: string): Analysis =>
	JSON.parse(readFileSync(resolve(import.meta.dirname, `../../__fixtures__/${name}.json`), 'utf8'));

/**
 * A brew that lands just *after* a proc expires is a different mistake from never brewing at all.
 * The player read the proc and moved; their latency or their hand cost them the snapshot. Both are
 * misses, but only one is a timing problem, and the report used to tell both of them "proc expired
 * with no brew cast at all" — which was simply false for the first.
 */
describe('narrowly missed snapshots', () => {
	it('catches a brew that went out a fraction too late', () => {
		const mixed = fixture('mixed');
		const near = mixed.procs.windows.filter((w) => w.missedByMs !== null);

		expect(mixed.procs.narrowlyMissed).toBe(1);
		expect(near).toHaveLength(1);
		// The proc ended at 10789 and the brew went at 11506.
		expect(near[0]?.missedByMs).toBe(717);
		expect(near[0]?.snapshotAt).toBeNull();
	});

	/** Twenty-one milliseconds. Nothing about that is a habit, and the copy must not imply one. */
	it('catches one missed by a rounding error', () => {
		const poor = fixture('poor');
		expect(poor.procs.narrowlyMissed).toBe(1);
		expect(poor.procs.windows.find((w) => w.missedByMs !== null)?.missedByMs).toBe(21);
	});

	/**
	 * It has to stay rare, or it stops meaning anything. A brew forty-five seconds after a proc is
	 * the next rotation, not a late reaction.
	 */
	it('does not fire for a brew that simply happened later', () => {
		const mixed = fixture('mixed');
		const unsnapshotted = mixed.procs.windows.filter((w) => w.snapshotAt === null);
		expect(unsnapshotted.length).toBeGreaterThan(1);
		expect(unsnapshotted.filter((w) => w.missedByMs !== null)).toHaveLength(1);
	});

	it('does not fire on a pull that caught its procs cleanly', () => {
		expect(fixture('strong').procs.narrowlyMissed).toBe(0);
	});

	/** The ledger has to describe what happened, not the generic version of it. */
	it('tells the ledger what actually happened', () => {
		const entries = fixture('mixed').misses.filter((m) => m.kind.startsWith('Rune proc unsnapshotted'));
		const late = entries.filter((m) => m.detail.includes('after the proc expired'));
		expect(late).toHaveLength(1);
		expect(late[0]?.detail).toContain('0.7s');
		expect(late[0]?.detail).not.toContain('no brew cast at all');
	});
});
