import type { ResourceCurve } from '~/lib/types';

export function resourceCurveFromPoints(points: readonly [number, number][], max: number): ResourceCurve | null {
	return points.length === 0 ? null : { max, points: points.map(([at, value]): [number, number] => [at, value]) };
}
