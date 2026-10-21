import type { Category } from '../model.js';

export interface HostRule {
  /** Matches this host and its subdomains. */
  host: string;
  /** Optional path prefix, for hosts that serve ordinary content too. */
  path?: string;
  vendor: string;
  category: Category;
  /** Where the host is documented: vendor docs, or the tool's own source. */
  source: string;
}

/**
 * Known telemetry, error-reporting, feature-flag and update-check endpoints.
 * Every entry cites a public source; all were checked on 2026-10-21 (docs/RESEARCH.md §6).
 */
export const HOST_RULES: readonly HostRule[] = [
  // Developer tools' own telemetry endpoints.
  { host: 'telemetry.nextjs.org', vendor: 'Next.js telemetry', category: 'analytics', source: 'https://nextjs.org/telemetry' },
  { host: 'telemetry.astro.build', vendor: 'Astro telemetry', category: 'analytics', source: 'https://astro.build/telemetry/' },
  { host: 'telemetry.nuxt.com', vendor: 'Nuxt telemetry', category: 'analytics', source: 'https://github.com/nuxt/telemetry' },
  { host: 'telemetry.vercel.com', vendor: 'Vercel telemetry (Turborepo, Vercel CLI)', category: 'analytics', source: 'https://turborepo.dev/docs/telemetry' },
  { host: 'checkpoint.prisma.io', vendor: 'Prisma checkpoint', category: 'analytics', source: 'https://www.prisma.io/docs/v6/orm/tools/prisma-cli' },
  { host: 'prisma.build', path: '/events', vendor: 'Prisma CLI telemetry', category: 'analytics', source: 'https://github.com/prisma/prisma-cli/blob/main/packages/cli-engine/src/telemetry/endpoint.ts' },
  { host: 'storybook.js.org', path: '/event-log', vendor: 'Storybook telemetry', category: 'analytics', source: 'https://storybook.js.org/docs/configure/telemetry' },
  { host: 'cdp.expo.dev', vendor: 'Expo CLI telemetry', category: 'analytics', source: 'https://github.com/expo/expo/blob/main/packages/@expo/cli/src/utils/telemetry/utils/constants.ts' },
  { host: 'cli.netlify.com', path: '/telemetry', vendor: 'Netlify CLI telemetry', category: 'analytics', source: 'https://github.com/netlify/cli/blob/main/src/utils/telemetry/request.ts' },
  { host: 'sparrow.cloudflare.com', vendor: 'Wrangler metrics', category: 'analytics', source: 'https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/telemetry.md' },
  { host: 'sentry10.cfdata.org', vendor: 'Wrangler error reports', category: 'errors', source: 'https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/telemetry.md' },
  { host: 'analytics.brew.sh', vendor: 'Homebrew analytics', category: 'analytics', source: 'https://docs.brew.sh/Analytics' },
  { host: 'aws-serverless-tools-telemetry.us-west-2.amazonaws.com', vendor: 'AWS SAM CLI telemetry', category: 'analytics', source: 'https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-telemetry.html' },
  { host: 'cdk-cli-telemetry.us-east-1.api.aws', vendor: 'AWS CDK CLI telemetry', category: 'analytics', source: 'https://docs.aws.amazon.com/cdk/v2/guide/cli-telemetry.html' },
  { host: 'play.googleapis.com', path: '/log', vendor: 'Google Clearcut (gcloud, Gemini CLI)', category: 'analytics', source: 'https://docs.cloud.google.com/sdk/docs/usage-statistics' },
  { host: 'checkpoint-api.hashicorp.com', vendor: 'HashiCorp Checkpoint version check', category: 'updates', source: 'https://github.com/hashicorp/go-checkpoint/blob/e64f9420adab9fef9b21510047fb326998b60c58/check.go' },
  { host: 'checkpoint-api.hashicorp.com', path: '/v1/telemetry', vendor: 'HashiCorp Checkpoint telemetry', category: 'analytics', source: 'https://github.com/hashicorp/packer/blob/51ba09f6e41b5c46b9793f228abeb24c9210b03f/packer/telemetry.go' },
  { host: 'cafe.github.com', vendor: 'GitHub CLI telemetry', category: 'analytics', source: 'https://github.com/cli/cli/blob/ad27e286ab6eb101f192176defdfea7475e2a267/internal/telemetry/telemetry.go' },
  { host: 'chatgpt.com', path: '/backend-api/codex/analytics-events', vendor: 'Codex CLI analytics', category: 'analytics', source: 'https://github.com/openai/codex/blob/c7234c1174b27d9c55199fba0d546dc27d1b0415/codex-rs/analytics/src/client.rs' },
  { host: 'ab.chatgpt.com', path: '/otlp', vendor: 'Codex CLI metrics', category: 'analytics', source: 'https://github.com/openai/codex/blob/c7234c1174b27d9c55199fba0d546dc27d1b0415/codex-rs/otel/src/config.rs' },
  { host: 'dl.deno.land', vendor: 'Deno update check', category: 'updates', source: 'https://docs.deno.com/runtime/reference/env_variables/' },
  { host: 'bun.report', vendor: 'Bun crash reports', category: 'errors', source: 'https://github.com/oven-sh/bun/blob/9b4284f788f20e3d6ec8358daf62ad10694b158a/docs/runtime/environment-variables.mdx' },
  { host: 'ollama.com', path: '/api/update', vendor: 'Ollama update check', category: 'updates', source: 'https://github.com/ollama/ollama/blob/2cd63f7a15039ccd790e97b31edc091fa1707c56/app/updater/updater.go' },
  { host: 'huggingface.co', path: '/api/telemetry', vendor: 'Hugging Face Hub telemetry', category: 'analytics', source: 'https://huggingface.co/docs/huggingface_hub/package_reference/environment_variables' },
  { host: 'api.gradio.app', vendor: 'Gradio analytics', category: 'analytics', source: 'https://github.com/gradio-app/gradio/blob/main/gradio/analytics.py' },
  { host: 'data.streamlit.io', vendor: 'Streamlit usage stats', category: 'analytics', source: 'https://github.com/streamlit/streamlit/blob/develop/frontend/app/src/MetricsManager.ts' },
  { host: 'api.wandb.ai', path: '/sdk/otel', vendor: 'Weights & Biases SDK telemetry', category: 'analytics', source: 'https://github.com/wandb/wandb/blob/main/wandb/analytics/opentelemetry/opentelemetry_proxy.py' },
  { host: 'core.serverless.com', path: '/api/events', vendor: 'Serverless Framework telemetry', category: 'analytics', source: 'https://github.com/serverless/serverless/blob/main/packages/util/src/telemetry/index.js' },
  { host: 'api.ionicjs.com', path: '/events/metrics', vendor: 'Ionic CLI telemetry', category: 'analytics', source: 'https://github.com/ionic-team/ionic-cli/blob/develop/packages/@ionic/cli/src/lib/telemetry.ts' },
  { host: 'metrics-capacitor.outsystems.com', vendor: 'Capacitor CLI telemetry', category: 'analytics', source: 'https://capacitorjs.com/docs/cli/telemetry' },

  // Analytics, error-reporting and feature-flag SDK ingestion hosts.
  { host: 'segment.io', vendor: 'Segment', category: 'analytics', source: 'https://www.twilio.com/docs/segment/guides/regional-segment.md' },
  { host: 'segmentapis.com', vendor: 'Segment', category: 'analytics', source: 'https://www.twilio.com/docs/segment/guides/regional-segment.md' },
  { host: 'sentry.io', vendor: 'Sentry', category: 'errors', source: 'https://docs.sentry.io/security-legal-pii/security/ip-ranges/' },
  { host: 'datadoghq.com', vendor: 'Datadog', category: 'analytics', source: 'https://docs.datadoghq.com/api/latest/logs/' },
  { host: 'datadoghq.eu', vendor: 'Datadog', category: 'analytics', source: 'https://docs.datadoghq.com/api/latest/logs/' },
  { host: 'mixpanel.com', vendor: 'Mixpanel', category: 'analytics', source: 'https://docs.mixpanel.com/docs/privacy/eu-residency' },
  { host: 'amplitude.com', vendor: 'Amplitude', category: 'analytics', source: 'https://amplitude.com/docs/apis/analytics/http-v2' },
  { host: 'google-analytics.com', vendor: 'Google Analytics', category: 'analytics', source: 'https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events' },
  { host: 'i.posthog.com', vendor: 'PostHog', category: 'analytics', source: 'https://posthog.com/docs/api' },
  { host: 'api.statsig.com', vendor: 'Statsig', category: 'flags', source: 'https://docs.statsig.com/infrastructure/statsig_domains' },
  { host: 'events.statsigapi.net', vendor: 'Statsig', category: 'flags', source: 'https://docs.statsig.com/infrastructure/statsig_domains' },
  { host: 'prodregistryv2.org', vendor: 'Statsig', category: 'flags', source: 'https://docs.statsig.com/infrastructure/statsig_domains' },
  { host: 'featureassets.org', vendor: 'Statsig', category: 'flags', source: 'https://docs.statsig.com/infrastructure/statsig_domains' },
  { host: 'launchdarkly.com', vendor: 'LaunchDarkly', category: 'flags', source: 'https://launchdarkly.com/docs/sdk/features/service-endpoint-configuration' },
  { host: 'launchdarkly.us', vendor: 'LaunchDarkly', category: 'flags', source: 'https://launchdarkly.com/docs/sdk/features/service-endpoint-configuration' },
  { host: 'notify.bugsnag.com', vendor: 'Bugsnag', category: 'errors', source: 'https://github.com/bugsnag/bugsnag-js/blob/next/packages/core/config.js' },
  { host: 'sessions.bugsnag.com', vendor: 'Bugsnag', category: 'errors', source: 'https://github.com/bugsnag/bugsnag-js/blob/next/packages/core/config.js' },
  { host: 'bugsnag.smartbear.com', vendor: 'Bugsnag', category: 'errors', source: 'https://github.com/bugsnag/bugsnag-js/blob/next/packages/core/config.js' },
  { host: 'api.rollbar.com', vendor: 'Rollbar', category: 'errors', source: 'https://docs.rollbar.com/reference/create-item' },
  { host: 'honeycomb.io', vendor: 'Honeycomb', category: 'analytics', source: 'https://docs.honeycomb.io/send-data/opentelemetry/' },
  { host: 'nr-data.net', vendor: 'New Relic', category: 'analytics', source: 'https://docs.newrelic.com/docs/new-relic-solutions/get-started/networks/' },
  { host: 'collector.newrelic.com', vendor: 'New Relic', category: 'analytics', source: 'https://docs.newrelic.com/docs/new-relic-solutions/get-started/networks/' },
  { host: 'events.data.microsoft.com', vendor: 'Microsoft 1DS telemetry', category: 'analytics', source: 'https://learn.microsoft.com/en-us/microsoft-365/enterprise/urls-and-ip-address-ranges' },
  { host: 'in.applicationinsights.azure.com', vendor: 'Azure Application Insights', category: 'analytics', source: 'https://learn.microsoft.com/en-us/azure/azure-monitor/fundamentals/azure-monitor-network-access' },
  { host: 'dc.applicationinsights.azure.com', vendor: 'Azure Application Insights', category: 'analytics', source: 'https://learn.microsoft.com/en-us/azure/azure-monitor/fundamentals/azure-monitor-network-access' },
  { host: 'dc.services.visualstudio.com', vendor: 'Azure Application Insights', category: 'analytics', source: 'https://learn.microsoft.com/en-us/azure/azure-monitor/fundamentals/azure-monitor-network-access' },
  { host: 'crashlyticsreports-pa.googleapis.com', vendor: 'Firebase Crashlytics', category: 'errors', source: 'https://github.com/firebase/firebase-android-sdk/blob/main/transport/transport-backend-cct/src/main/java/com/google/android/datatransport/cct/CCTDestination.java' },
  { host: 'firebaselogging.googleapis.com', vendor: 'Firebase logging', category: 'analytics', source: 'https://github.com/firebase/firebase-android-sdk/blob/main/transport/transport-backend-cct/src/main/java/com/google/android/datatransport/cct/CCTDestination.java' },
  { host: 'firebaselogging-pa.googleapis.com', vendor: 'Firebase logging', category: 'analytics', source: 'https://github.com/firebase/firebase-android-sdk/blob/main/transport/transport-backend-cct/src/main/java/com/google/android/datatransport/cct/CCTDestination.java' },
  { host: 'heapanalytics.com', vendor: 'Heap', category: 'analytics', source: 'https://developers.heap.io/reference/track-1' },
  { host: 'heap-api.com', vendor: 'Heap', category: 'analytics', source: 'https://developers.heap.io/reference/track-1' },
  { host: 'data.pendo.io', vendor: 'Pendo', category: 'analytics', source: 'https://support.pendo.io/hc/en-us/articles/360032209131-Content-Security-Policy-CSP-' },
  { host: 'data.eu.pendo.io', vendor: 'Pendo', category: 'analytics', source: 'https://support.pendo.io/hc/en-us/articles/360032209131-Content-Security-Policy-CSP-' },
  { host: 'api.axiom.co', vendor: 'Axiom', category: 'analytics', source: 'https://axiom.co/docs/reference/edge-deployments' },
  { host: 'edge.axiom.co', vendor: 'Axiom', category: 'analytics', source: 'https://axiom.co/docs/reference/edge-deployments' },
  { host: 'plausible.io', path: '/api/event', vendor: 'Plausible', category: 'analytics', source: 'https://plausible.io/docs/events-api' },
  { host: 'gateway.umami.is', vendor: 'Umami', category: 'analytics', source: 'https://docs.umami.is/docs/api/sending-stats' },
  { host: 'in.appcenter.ms', vendor: 'Visual Studio App Center', category: 'analytics', source: 'https://learn.microsoft.com/en-us/appcenter/retirement' },
  { host: 'grafana.net', path: '/collect/', vendor: 'Grafana Faro', category: 'analytics', source: 'https://grafana.com/docs/grafana-cloud/monitor-applications/frontend-observability/configure/process-faro-telemetry/' },
];
