import type { TFunction } from 'i18next';

import { WclError } from '~/lib/wcl';

export interface Failure {
	title: string;
	detail: string;
	/** True when the token itself is what was refused, so the fix is a new one rather than a retry. */
	tokenAtFault: boolean;
}

/**
 * WclError already writes its messages for the person who signed in, so the message is passed
 * through untouched; the kind only decides the heading above it and whether to offer a way out.
 *
 * `t` is a parameter rather than a hook because this is not a component and there is no render to
 * hang one off. There are two callers, so passing it costs a word at each and keeps this pure — the
 * headings can be asserted without mounting anything.
 *
 * **The fallback is the only branch that is not a WarcraftLogs answer.** All six `WclErrorKind`s are
 * handled above it, so nothing but a throw that is not a `WclError` reaches it — which is what the
 * copy now says. It used to say "Something went wrong", twice, which was the same non-statement in
 * the heading and in the body and told a reader nothing they had not already worked out.
 */
export function describeFailure(error: unknown, t: TFunction<'ui'>): Failure {
	if (error instanceof WclError) {
		switch (error.kind) {
			case 'auth':
				return { tokenAtFault: true, title: t('errors.auth'), detail: error.message };
			case 'missing':
				return { tokenAtFault: false, title: t('errors.missing'), detail: error.message };
			case 'rate-limit':
				return { tokenAtFault: false, title: t('errors.rateLimit'), detail: error.message };
			case 'network':
				return { tokenAtFault: false, title: t('errors.network'), detail: error.message };
			case 'server':
				return { tokenAtFault: false, title: t('errors.server'), detail: error.message };
			case 'graphql':
				return { tokenAtFault: false, title: t('errors.graphql'), detail: error.message };
		}
	}
	return {
		tokenAtFault: false,
		title: t('errors.unknownTitle'),
		detail: error instanceof Error ? error.message : t('errors.unknownDetail'),
	};
}
