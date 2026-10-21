import { withPreload } from './preload.js';

export interface ChildEnvInput {
  base: NodeJS.ProcessEnv;
  /** `http://127.0.0.1:PORT`. */
  proxyUrl: string;
  caPath: string;
  bundlePath: string;
  /** JKS truststore with the CA and the normal roots; enables the JVM settings when given. */
  javaTrustPath?: string;
  /** Node preload for versions that ignore NODE_USE_ENV_PROXY (added to NODE_OPTIONS). */
  nodePreload?: string;
  /** Opt-out variables to set (compare's second run, or run --opt-out). */
  optOut?: Record<string, string>;
  /** Variables to remove so a "default" run really is default (compare's first run). */
  remove?: readonly string[];
  /** User-supplied --env values; applied last. */
  extra?: Record<string, string>;
}

export interface ChildEnv {
  env: NodeJS.ProcessEnv;
  /** Names from `remove` that were actually set in the parent environment. */
  removed: string[];
}

const PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'];

/**
 * The child's environment: every common runtime is pointed at the proxy and told to
 * trust the run's CA through standard variables. Upper and lower case are both set
 * because runtimes disagree on precedence (curl ignores HTTP_PROXY; Go reads upper first).
 */
export function buildChildEnv(input: ChildEnvInput): ChildEnv {
  const env: NodeJS.ProcessEnv = { ...input.base };
  delete env.NO_PROXY;
  delete env.no_proxy;
  const removed: string[] = [];
  for (const name of input.remove ?? []) {
    if (env[name] !== undefined) {
      removed.push(name);
      delete env[name];
    }
  }
  for (const v of PROXY_VARS) env[v] = input.proxyUrl;
  // Node ≥ 22.21 / 24: built-in proxy support for fetch and http(s). Never via NODE_OPTIONS:
  // Node 22.19 refuses to start with --use-env-proxy there.
  env.NODE_USE_ENV_PROXY = '1';
  env.NODE_EXTRA_CA_CERTS = input.caPath;
  env.DENO_CERT = input.caPath;
  // These replace the default trust store, so they get the CA plus the normal roots.
  env.SSL_CERT_FILE = input.bundlePath;
  env.REQUESTS_CA_BUNDLE = input.bundlePath;
  env.CURL_CA_BUNDLE = input.bundlePath;
  env.GIT_SSL_CAINFO = input.bundlePath;
  if (input.nodePreload) {
    env.NODE_OPTIONS = withPreload(input.base.NODE_OPTIONS, input.nodePreload);
    env.WHATLEAKS_PRELOAD = '1';
  }
  if (input.javaTrustPath) env.JAVA_TOOL_OPTIONS = javaToolOptions(input.base.JAVA_TOOL_OPTIONS, input.proxyUrl, input.javaTrustPath);
  Object.assign(env, input.optOut ?? {}, input.extra ?? {});
  return { env, removed };
}

/**
 * The JVM ignores HTTP(S)_PROXY. JAVA_TOOL_OPTIONS is read by every JVM at startup, so
 * the proxy and truststore system properties reach Java apps (and the JVMs they start)
 * without changing their command line. Read by HttpClient, HttpURLConnection, OkHttp and
 * anything else using the default ProxySelector. Existing options are kept, after ours,
 * so the user's own settings still win. The JVM prints "Picked up JAVA_TOOL_OPTIONS".
 */
export function javaToolOptions(existing: string | undefined, proxyUrl: string, trustStore: string): string {
  const { hostname, port } = new URL(proxyUrl);
  const q = (v: string): string => (/\s/.test(v) ? `"${v}"` : v);
  const ours = [
    `-Dhttp.proxyHost=${hostname}`,
    `-Dhttp.proxyPort=${port}`,
    `-Dhttps.proxyHost=${hostname}`,
    `-Dhttps.proxyPort=${port}`,
    `-Djavax.net.ssl.trustStore=${q(trustStore)}`,
    '-Djavax.net.ssl.trustStoreType=JKS',
    '-Djavax.net.ssl.trustStorePassword=changeit',
  ].join(' ');
  return existing?.trim() ? `${ours} ${existing.trim()}` : ours;
}
