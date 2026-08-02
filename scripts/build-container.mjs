import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npmCommand, ['run', 'build'], {
	env: { ...process.env, KITE_BUILD_TARGET: 'container' },
	stdio: 'inherit'
});

child.on('error', (error) => {
	throw error;
});

child.on('exit', (code, signal) => {
	if (signal) process.kill(process.pid, signal);
	process.exitCode = code ?? 1;
});
