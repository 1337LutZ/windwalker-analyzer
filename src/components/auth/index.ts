export { default as ClientIdPanel } from './ClientIdPanel';
export { default as ClientIdSetup } from './ClientIdSetup';
export { default as ManualTokenForm } from './ManualTokenForm';
export { default as SessionProvider } from './SessionProvider';
export { default as SignInButton } from './SignInButton';
export { default as SignInPanel } from './SignInPanel';
export { default as TokenHelp } from './TokenHelp';

// The session itself lives in `~/lib/auth`; it is re-exported here because this is the folder the
// rest of the app was written against. `useAuthSession` / `AuthSession` / `AuthStatus` were the
// names of the placeholder this replaced — same status values, and now the token's origin with it.
export { useSession, useSession as useAuthSession } from '~/lib/auth';
export type {
	Session,
	Session as AuthSession,
	SessionStatus,
	SessionStatus as AuthStatus,
	TokenSource,
} from '~/lib/auth';
