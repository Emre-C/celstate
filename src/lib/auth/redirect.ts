export const buildAuthRedirectTarget = (pathname: string, search: string) => {
	const redirectTo = `${pathname}${search}`;
	return `/auth?redirectTo=${encodeURIComponent(redirectTo)}`;
};
