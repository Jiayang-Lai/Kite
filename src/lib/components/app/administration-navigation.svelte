<script lang="ts">
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
	import SquareTerminalIcon from '@lucide/svelte/icons/square-terminal';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import { page } from '$app/state';

	import * as Sidebar from '$lib/components/ui/sidebar';

	const isOverviewPage = $derived(page.url.pathname === '/admin');
	const isCommandsPage = $derived(page.url.pathname === '/admin/commands');
	const isDatabasesPage = $derived(page.url.pathname === '/admin/databases');
	const isIngestionPage = $derived(page.url.pathname === '/admin/ingestion');
</script>

<Sidebar.Group>
	<Sidebar.GroupLabel>Admin</Sidebar.GroupLabel>
	<Sidebar.Menu>
		<Sidebar.MenuItem>
			<Sidebar.MenuButton isActive={isOverviewPage} tooltipContent="Admin overview">
				{#snippet child({ props })}
					<a {...props} href="/admin">
						<LayoutDashboardIcon />
						<span>Overview</span>
					</a>
				{/snippet}
			</Sidebar.MenuButton>
		</Sidebar.MenuItem>
		<Sidebar.MenuItem>
			<Sidebar.MenuButton isActive={isCommandsPage} tooltipContent="Commands">
				{#snippet child({ props })}
					<a {...props} href="/admin/commands">
						<SquareTerminalIcon />
						<span>Commands</span>
					</a>
				{/snippet}
			</Sidebar.MenuButton>
		</Sidebar.MenuItem>
		<Sidebar.MenuItem>
			<Sidebar.MenuButton isActive={isDatabasesPage} tooltipContent="Databases and tables">
				{#snippet child({ props })}
					<a {...props} href="/admin/databases">
						<DatabaseIcon />
						<span>Databases &amp; tables</span>
					</a>
				{/snippet}
			</Sidebar.MenuButton>
		</Sidebar.MenuItem>
		<Sidebar.MenuItem>
			<Sidebar.MenuButton isActive={isIngestionPage} tooltipContent="Data ingestion">
				{#snippet child({ props })}
					<a {...props} href="/admin/ingestion">
						<UploadIcon />
						<span>Data ingestion</span>
					</a>
				{/snippet}
			</Sidebar.MenuButton>
		</Sidebar.MenuItem>
	</Sidebar.Menu>
</Sidebar.Group>
