import adapter from '@sveltejs/adapter-vercel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
				kit: {
				 adapter: adapter(),

					paths: {
						relative: false,
					},

				 alias: {
									$convex: './src/convex',
					},

				 experimental: {
					 tracing: {
						 server: true
						},

					 instrumentation: {
						 server: true
						}
					}
				}
};

export default config;
