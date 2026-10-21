export interface OptOut {
  /** Environment variable name. */
  name: string;
  /** The documented value that opts out. */
  value: string;
  /** Tools documented (or seen in their source) to read it. */
  tools: string[];
  source: string;
  /** Kind of traffic it turns off, when it is not plain telemetry. */
  note?: string;
}

/**
 * Documented environment-variable opt-outs, used by `compare` and `run --opt-out`.
 * Tools that only offer a config-file or command opt-out are not here; use `--off-env`
 * or a manual before/after with `whatleaks diff`. Checked on 2026-10-21 (docs/RESEARCH.md §6).
 */
export const OPT_OUTS: readonly OptOut[] = [
  { name: 'DO_NOT_TRACK', value: '1', tools: ['Bun', 'Turborepo', 'Nuxt', 'Netlify CLI', 'Wrangler', 'GitHub CLI', 'Hugging Face Hub', 'Prisma CLI 8'], source: 'https://turborepo.dev/docs/telemetry', note: 'cross-tool convention; only tools that implement it honour it' },
  { name: 'NEXT_TELEMETRY_DISABLED', value: '1', tools: ['Next.js'], source: 'https://nextjs.org/telemetry' },
  { name: 'ASTRO_TELEMETRY_DISABLED', value: '1', tools: ['Astro'], source: 'https://astro.build/telemetry/' },
  { name: 'NUXT_TELEMETRY_DISABLED', value: '1', tools: ['Nuxt'], source: 'https://github.com/nuxt/telemetry' },
  { name: 'GATSBY_TELEMETRY_DISABLED', value: '1', tools: ['Gatsby'], source: 'https://github.com/gatsbyjs/gatsby/pull/39137' },
  { name: 'NG_CLI_ANALYTICS', value: 'false', tools: ['Angular CLI'], source: 'https://github.com/angular/angular-cli/blob/main/packages/angular/cli/src/utilities/environment-options.ts' },
  { name: 'TURBO_TELEMETRY_DISABLED', value: '1', tools: ['Turborepo'], source: 'https://turborepo.dev/docs/telemetry' },
  { name: 'VERCEL_TELEMETRY_DISABLED', value: '1', tools: ['Vercel CLI'], source: 'https://vercel.com/docs/cli/about-telemetry' },
  { name: 'CHECKPOINT_DISABLE', value: '1', tools: ['Prisma 7', 'Terraform', 'Packer'], source: 'https://developer.hashicorp.com/terraform/cli/commands', note: 'also turns off version checks' },
  { name: 'PRISMA_DISABLE_TELEMETRY', value: '1', tools: ['Prisma CLI 8'], source: 'https://github.com/prisma/prisma-cli/blob/main/packages/cli-engine/src/telemetry/gating.ts' },
  { name: 'STORYBOOK_DISABLE_TELEMETRY', value: 'true', tools: ['Storybook'], source: 'https://storybook.js.org/docs/configure/telemetry' },
  { name: 'EXPO_NO_TELEMETRY', value: '1', tools: ['Expo CLI'], source: 'https://docs.expo.dev/more/expo-cli/' },
  { name: 'NETLIFY_TELEMETRY_DISABLED', value: '1', tools: ['Netlify CLI ≥27.13'], source: 'https://github.com/netlify/cli/pull/8620' },
  { name: 'WRANGLER_SEND_METRICS', value: 'false', tools: ['Wrangler'], source: 'https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/telemetry.md' },
  { name: 'YARN_ENABLE_TELEMETRY', value: '0', tools: ['Yarn Berry'], source: 'https://yarnpkg.com/advanced/telemetry' },
  { name: 'HOMEBREW_NO_ANALYTICS', value: '1', tools: ['Homebrew'], source: 'https://docs.brew.sh/Analytics' },
  { name: 'DOTNET_CLI_TELEMETRY_OPTOUT', value: '1', tools: ['.NET CLI'], source: 'https://learn.microsoft.com/en-us/dotnet/core/tools/telemetry' },
  { name: 'AZURE_CORE_COLLECT_TELEMETRY', value: 'false', tools: ['Azure CLI'], source: 'https://learn.microsoft.com/en-us/cli/azure/azure-cli-configuration' },
  { name: 'SAM_CLI_TELEMETRY', value: '0', tools: ['AWS SAM CLI'], source: 'https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-telemetry.html' },
  { name: 'CDK_DISABLE_CLI_TELEMETRY', value: 'true', tools: ['AWS CDK CLI'], source: 'https://docs.aws.amazon.com/cdk/v2/guide/cli-telemetry.html' },
  { name: 'CLOUDSDK_CORE_DISABLE_USAGE_REPORTING', value: 'true', tools: ['gcloud'], source: 'https://docs.cloud.google.com/sdk/docs/usage-statistics' },
  { name: 'VAGRANT_CHECKPOINT_DISABLE', value: '1', tools: ['Vagrant'], source: 'https://developer.hashicorp.com/vagrant/docs/other/environmental-variables', note: 'also turns off version checks' },
  { name: 'GH_TELEMETRY', value: '0', tools: ['GitHub CLI'], source: 'https://cli.github.com/manual/gh_help_environment' },
  { name: 'DISABLE_TELEMETRY', value: '1', tools: ['Claude Code'], source: 'https://code.claude.com/docs/en/data-usage' },
  { name: 'DISABLE_ERROR_REPORTING', value: '1', tools: ['Claude Code'], source: 'https://code.claude.com/docs/en/data-usage', note: 'error reports' },
  { name: 'DENO_NO_UPDATE_CHECK', value: '1', tools: ['Deno'], source: 'https://docs.deno.com/runtime/reference/env_variables/', note: 'update check, not telemetry' },
  { name: 'HF_HUB_DISABLE_TELEMETRY', value: '1', tools: ['Hugging Face Hub'], source: 'https://huggingface.co/docs/huggingface_hub/package_reference/environment_variables' },
  { name: 'GRADIO_ANALYTICS_ENABLED', value: 'False', tools: ['Gradio'], source: 'https://github.com/gradio-app/gradio/blob/main/gradio/analytics.py' },
  { name: 'STREAMLIT_BROWSER_GATHER_USAGE_STATS', value: 'false', tools: ['Streamlit'], source: 'https://docs.streamlit.io/develop/api-reference/configuration/config.toml' },
  { name: 'WANDB_ERROR_REPORTING', value: 'false', tools: ['Weights & Biases'], source: 'https://github.com/wandb/wandb/blob/main/wandb/analytics/opentelemetry/opentelemetry_proxy.py' },
  { name: 'SF_DISABLE_TELEMETRY', value: 'true', tools: ['Salesforce CLI'], source: 'https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_dev_cli_telemetry.htm' },
  { name: 'SLS_TELEMETRY_DISABLED', value: '1', tools: ['Serverless Framework v3'], source: 'https://github.com/serverless/serverless/blob/main/packages/util/src/telemetry/index.js' },
];

export function optOutEnv(entries: readonly OptOut[] = OPT_OUTS): Record<string, string> {
  return Object.fromEntries(entries.map((e) => [e.name, e.value]));
}
