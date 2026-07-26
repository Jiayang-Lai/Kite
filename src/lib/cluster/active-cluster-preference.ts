export const ACTIVE_CLUSTER_COOKIE_NAME = 'kite_active_cluster_id';
export const ACTIVE_CLUSTER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Reads the client-side active-cluster preference. */
export function getPersistedActiveClusterId() {
	if (typeof document === 'undefined') return undefined;
	const clusterCookie = document.cookie
		.split('; ')
		.find((cookie) => cookie.startsWith(`${ACTIVE_CLUSTER_COOKIE_NAME}=`));
	return clusterCookie ? decodeURIComponent(clusterCookie.split('=')[1]) : undefined;
}

/** Persists the most recently confirmed cluster connection for the next browser load. */
export function persistActiveClusterId(clusterId: string) {
	if (typeof document === 'undefined') return;
	document.cookie = `${ACTIVE_CLUSTER_COOKIE_NAME}=${encodeURIComponent(clusterId)}; path=/; max-age=${ACTIVE_CLUSTER_COOKIE_MAX_AGE}; samesite=lax`;
}
