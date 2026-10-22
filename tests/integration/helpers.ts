import request from 'supertest';
import { app } from '../../apps/api/src/app';
export const origin = 'http://localhost:3000';
export type Result = Awaited<ReturnType<ReturnType<typeof request>['get']>>;
export class SessionClient {
  cookies = ''; csrf = ''; id = ''; username = '';
  async request(method: 'get'|'post'|'patch'|'put'|'delete', path: string, body?: unknown) {
    let call = request(app)[method](`/api${path}`).set('Origin', origin);
    if (this.cookies) call = call.set('Cookie', this.cookies).set('x-csrf-token', this.csrf);
    if (body !== undefined) call = call.send(body);
    return call;
  }
  async register(label: string) {
    const name = `${label}${Math.random().toString(36).slice(2, 7)}`.slice(0, 24);
    const res = await this.request('post', '/auth/register', { email: `${name}@example.test`, username: name, displayName: label, password: 'a very strong password 123!' });
    if (res.status !== 201) throw new Error(`Registration failed (${res.status}): ${JSON.stringify(res.body)}`);
    this.remember(res); this.id = res.body.user.id; this.username = name;
    return res;
  }
  remember(res: Result) {
    const headers = res.headers['set-cookie'] as string[] | undefined;
    if (headers?.length) { this.cookies = headers.map(v => v.split(';')[0]).join('; '); this.csrf = /cove_csrf=([a-f0-9]+)/.exec(this.cookies)?.[1] || ''; }
  }
}
