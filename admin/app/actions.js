'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { api, sessionCookie } from '../lib/iskra';

export async function signIn(form) {
  const token = String(form.get('token') || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(token)) redirect('/?notice=invalid-token');
  const response = await api('/v1/admin/overview', token).catch(() => null);
  if (!response || response.status >= 500) redirect('/?notice=unavailable');
  if (!response.ok) redirect('/?notice=invalid-token');

  const jar = await cookies();
  jar.set(sessionCookie, token, {
    httpOnly: true,
    secure: process.env.ISKRA_ADMIN_COOKIE_SECURE !== 'false',
    sameSite: 'strict',
    path: '/',
    maxAge: 24 * 60 * 60,
  });
  redirect('/');
}

export async function signOut() {
  const jar = await cookies();
  const token = jar.get(sessionCookie)?.value;
  if (token) await api('/v1/auth/logout', token, { method: 'POST' }).catch(() => null);
  jar.delete(sessionCookie);
  redirect('/');
}

export async function saveLimits(form) {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token) redirect('/?notice=invalid-token');
  const accountId = String(form.get('accountId') || '');
  const requests = String(form.get('requests') || '');
  const attachments = String(form.get('attachments') || '');
  if (!/^[a-f0-9-]{36}$/i.test(accountId) || !/^\d{1,6}$/.test(requests) || !/^\d{1,6}$/.test(attachments)) {
    redirect('/?notice=invalid-limits');
  }
  const response = await api(`/v1/admin/accounts/${accountId}/limits`, token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dailyRequests: Number(requests), dailyAttachments: Number(attachments) }),
  }).catch(() => null);
  if (!response || response.status >= 500) redirect('/?notice=unavailable');
  if (response.status === 401 || response.status === 403) redirect('/?notice=invalid-token');
  redirect(response.ok ? '/?notice=saved' : '/?notice=invalid-limits');
}
