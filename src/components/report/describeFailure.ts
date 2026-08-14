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
 */
export function describeFailure(error: unknown): Failure {
	if (error instanceof WclError) {
		switch (error.kind) {
			case 'auth':
				return {
					tokenAtFault: true,
					title: 'WarcraftLogs would not accept that sign-in',
					detail: error.message,
				};
			case 'missing':
				return {
					tokenAtFault: false,
					title: 'Not in that report',
					detail: error.message,
				};
			case 'rate-limit':
				return {
					tokenAtFault: false,
					title: 'WarcraftLogs is rate-limiting this account',
					detail: error.message,
				};
			case 'network':
				return {
					tokenAtFault: false,
					title: 'Could not reach WarcraftLogs',
					detail: error.message,
				};
			case 'server':
				return {
					tokenAtFault: false,
					title: 'WarcraftLogs had a problem',
					detail: error.message,
				};
			case 'graphql':
				return {
					tokenAtFault: false,
					title: 'WarcraftLogs rejected the query',
					detail: error.message,
				};
		}
	}
	return {
		tokenAtFault: false,
		title: 'Something went wrong',
		detail: error instanceof Error ? error.message : 'Something went wrong talking to WarcraftLogs.',
	};
}
