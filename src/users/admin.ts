// The admin's Readers tab (/admin/users/*): everyone the site's login let in, their roles and extra features, and the roles themselves. Behind the
// admin's own Access check and the same-origin rule for writes in src/index.ts, like every other admin route.
import { json } from '../lib/twitterapi';
import { FEATURES } from './model';

export async function handleUsersAdmin(request: Request, env: Env, rest: string): Promise<Response> {
  const users = env.USERS.getByName('main'), what = rest.slice('/users/'.length);
  const status = async () => ({ enabled: !!env.SITE_POLICY_AUD, features: FEATURES, roles: await users.roles(), users: await users.list() });
  try {
    if (request.method === 'GET' && what === 'list') return json(await status());
    if (request.method !== 'POST') return json({ error: 'not found' }, 404);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (what === 'set') { await users.setUser(String(b.email ?? ''), String(b.role ?? ''), b.extra); return json(await status()); }
    if (what === 'remove') { await users.removeUser(String(b.email ?? '')); return json(await status()); }
    if (what === 'roles') { await users.setRoles(b.roles); return json(await status()); }
    return json({ error: 'not found' }, 404);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
}
