import type { LayoutServerLoad } from './$types';

import { SIDEBAR_COOKIE_NAME } from '$lib/components/ui/sidebar/constants.js';

export const load: LayoutServerLoad = ({ cookies }) => ({
	sidebarOpen: cookies.get(SIDEBAR_COOKIE_NAME) !== 'false'
});
