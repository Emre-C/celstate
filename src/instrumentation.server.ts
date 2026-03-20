import * as Sentry from '@sentry/sveltekit';

Sentry.init({
  dsn: 'https://02ede8116352a88253602c00d8a4f134@o4510330822197248.ingest.us.sentry.io/4511077711347712',

  tracesSampleRate: 1.0,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: import.meta.env.DEV,
});