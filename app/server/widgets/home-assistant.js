// Shared Home Assistant REST API helper. The token is only used by this
// server-side module and is never returned to the browser.
export function haConfigured(config) {
  return Boolean(config.get('REFRAME_HA_URL') && config.get('REFRAME_HA_TOKEN'));
}

export function homeAssistantEntities(config, key) {
  return config.get(key)
    .split(',')
    .map((entity) => entity.trim())
    .filter((entity) => /^[a-z0-9_]+\.[a-z0-9_]+$/.test(entity));
}

export async function haRequest(ctx, path, { method = 'GET', body } = {}) {
  const base = ctx.config.get('REFRAME_HA_URL').replace(/\/+$/, '');
  const url = new URL(path, `${base}/`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('REFRAME_HA_URL must start with http:// or https://');
  return ctx.fetchJson(url.toString(), {
    method,
    headers: {
      authorization: `Bearer ${ctx.config.get('REFRAME_HA_TOKEN')}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export async function haService(ctx, domain, service, body) {
  return haRequest(ctx, `/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, {
    method: 'POST',
    body,
  });
}
