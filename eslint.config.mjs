import nextConfig from 'eslint-config-next';

// These rules flag pre-existing patterns that we want to track but not block
// CI on until fixed incrementally. Downgrade all to warnings so the lint step
// reports issues without breaking the build on existing code.
const existingCodeWarnings = {
	'react-hooks/set-state-in-effect': 'warn',
	'react-hooks/refs': 'warn',
	'react-hooks/exhaustive-deps': 'warn',
	'react-hooks/preserve-manual-memoization': 'warn',
	'no-unused-vars': 'warn'
};

export default [
	...nextConfig,
	{
		rules: existingCodeWarnings
	}
];
