import { useContext } from 'react';

import { SessionContext, type Session } from './sessionContext';

/** The signed-in state, from anywhere under `SessionProvider`. */
export function useSession(): Session {
	const session = useContext(SessionContext);
	if (session === null) throw new Error('useSession was called outside a SessionProvider.');
	return session;
}
