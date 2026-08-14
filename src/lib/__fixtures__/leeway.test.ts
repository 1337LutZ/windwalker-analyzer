// Verifies that the snapshot-leeway setting re-reads a real pull, and re-reads only what it should.
//
// Skips itself without a token, so a normal `vitest run` is unaffected. It exists because the unit
// tests around `clampLeeway` prove the number is safe, not that it changes anything.
import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '~/lib/settings';
import { analyse } from '~/lib/spec/windwalker';
import { WclClient, fetchFightDataset } from '~/lib/wcl';

const token = process.env['WCL_TOKEN'] ?? '';

describe.skipIf(token === '')('snapshot leeway against a live pull', () => {
	it('reclassifies snapshots without touching anything else', { timeout: 180_000 }, async () => {
		const client = new WclClient({ token });
		// This pull is chosen because it has a snapshot landing 2.48s before its proc ended — inside the
		// widened window and outside the default one, which is exactly the case the setting exists for.
		// Most pulls have nothing in that band, so most pulls cannot demonstrate the change at all.
		const dataset = await fetchFightDataset(client, {
			code: 'a:YBQzrcgVJnAj7NMP',
			fightID: 30,
			playerName: 'Player (10)',
		});

		// Spread rather than written out: only the leeway is under test, and every other setting held at
		// its default is what makes the two runs comparable.
		const strict = analyse(dataset, { ...DEFAULT_SETTINGS, snapshotLeewayMs: 1000 });
		const generous = analyse(dataset, { ...DEFAULT_SETTINGS, snapshotLeewayMs: 2500 });

		// The window only decides which band a caught proc lands in.
		expect(generous.procs.lastGcd).toBeGreaterThan(strict.procs.lastGcd);
		// It must not change how many were caught, nor anything outside the snapshot grading.
		expect(generous.procs.snapshotted).toBe(strict.procs.snapshotted);
		expect(generous.procs.procs).toBe(strict.procs.procs);
		expect(generous.cpm.gcdUtilisationPct).toBe(strict.cpm.gcdUtilisationPct);
		expect(generous.filler.wasted).toBe(strict.filler.wasted);
		// And the chart's band follows the setting, or the picture would disagree with the number.
		expect(strict.procs.lastGcdMs).toBe(1000);
		expect(generous.procs.lastGcdMs).toBe(2500);
	});
});
