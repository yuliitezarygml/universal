import { cookies } from 'next/headers';
import { api, sessionCookie } from '../lib/iskra';
import { saveLimits, signIn, signOut } from './actions';

const notices = {
  'invalid-token': 'Введи действующий токен владельца.',
  'invalid-limits': 'Проверь лимиты. Число запросов с файлами не может превышать общий лимит.',
  unavailable: 'API временно недоступен.',
  saved: 'Лимит сохранён.',
};

const statuses = {
  started: 'В работе', succeeded: 'Готово', failed: 'Ошибка', cancelled: 'Отменён',
  active: 'Активен', blocked: 'Заблокирован', deletion_pending: 'Удаляется',
};

const number = new Intl.NumberFormat('ru-RU');

export default async function Home({ searchParams }) {
  const notice = notices[(await searchParams).notice];
  const token = (await cookies()).get(sessionCookie)?.value;
  const response = token ? await api('/v1/admin/overview', token).catch(() => null) : null;
  if (!response?.ok) {
    const message = notice || (token && (!response || response.status >= 500) ? notices.unavailable : token ? notices['invalid-token'] : null);
    return (
      <main className="login">
        <p className="brand">Искра</p>
        <h1>Панель владельца</h1>
        {message && <p role="status">{message}</p>}
        <form action={signIn}>
          <label>Токен владельца <input name="token" type="password" required autoComplete="off" spellCheck={false} /></label>
          <button type="submit">Войти</button>
        </form>
      </main>
    );
  }

  const { totals, accounts, attempts } = await response.json();
  return (
    <main className="dashboard">
      <header>
        <div><p className="brand">Искра</p><h1>Панель владельца</h1></div>
        <form action={signOut}><button className="secondary">Выйти</button></form>
      </header>
      {notice && <p className="notice" role="status">{notice}</p>}
      <section aria-label="Обзор">
        <h2>Обзор</h2>
        <p className="muted">Аккаунты за всё время. Запросы и токены за текущие сутки UTC.</p>
        <dl className="metrics">
          {[
            ['Аккаунты', totals.accounts], ['Вызовы моделей', totals.attemptsToday],
            ['Ошибки', totals.failedToday], ['Входные токены', totals.inputTokensToday],
            ['Выходные токены', totals.outputTokensToday], ['Без данных о токенах', totals.missingUsageToday],
          ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{number.format(value)}</dd></div>)}
        </dl>
      </section>
      <section>
        <h2>Аккаунты и лимиты</h2>
        <p className="muted">До 100 последних аккаунтов. Лимиты действуют на все устройства аккаунта.</p>
        <div className="table-scroll"><table>
          <thead><tr><th>Аккаунт</th><th>Статус</th><th>Запросы сегодня</th><th>Лимиты в сутки</th></tr></thead>
          <tbody>{accounts.map((account) => (
            <tr key={account.id}>
              <td>{account.email}{account.role === 'admin' && <small>Владелец</small>}</td>
              <td>{statuses[account.status] || account.status}</td>
              <td>{account.requestsToday} / {account.dailyRequests}</td>
              <td><form className="limits" action={saveLimits}>
                <input type="hidden" name="accountId" value={account.id} />
                <label>Запросы<input type="number" name="requests" defaultValue={account.dailyRequests} min="0" max="100000" required /></label>
                <label>С файлами<input type="number" name="attachments" defaultValue={account.dailyAttachments} min="0" max="100000" required /></label>
                <button type="submit">Сохранить</button>
              </form></td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
      <section>
        <h2>Последние вызовы моделей</h2>
        {attempts.length === 0 ? <p className="muted">Пока нет вызовов.</p> : (
          <div className="table-scroll"><table>
            <thead><tr><th>Время UTC</th><th>Аккаунт</th><th>Модель</th><th>Результат</th><th>Токены, вход / выход</th></tr></thead>
            <tbody>{attempts.map((attempt) => (
              <tr key={attempt.id}>
                <td>{attempt.startedAt}</td><td>{attempt.email}</td><td>{attempt.model}</td>
                <td>{statuses[attempt.status] || attempt.status}{attempt.upstreamStatus && ` · ${attempt.upstreamStatus}`}</td>
                <td>{attempt.inputTokens ?? '—'} / {attempt.outputTokens ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </main>
  );
}
