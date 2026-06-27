/** @type {import('next').NextConfig} */
const nextConfig = {
	// Allow building into an alternate output dir (e.g. staged deploys) without
	// disturbing the live .next; defaults to .next for dev/CI/runtime.
	distDir: process.env.NEXT_DIST_DIR || '.next',
	reactStrictMode: true,
	poweredByHeader: false,
	serverExternalPackages: ['pdf-parse', 'word-extractor', 'mammoth', 'sanitize-html'],
	async headers() {
		return [
			{
				source: '/(.*)',
				headers: [
					{ key: 'X-Content-Type-Options', value: 'nosniff' },
					{ key: 'X-Frame-Options', value: 'DENY' },
					{ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
					{
						key: 'Strict-Transport-Security',
						value: 'max-age=63072000; includeSubDomains; preload'
					}
				]
			}
		];
	}
};

export default nextConfig;
