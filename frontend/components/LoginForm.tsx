'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Lang, texts } from '@/lib/i18n';

type Props = {
  lang: Lang;
  onToken: (token: string) => void;
};

export default function LoginForm({ lang, onToken }: Props) {
  const t = texts[lang];
  const L = (bg: string, en: string, it?: string) => (lang === 'bg' ? bg : lang === 'it' ? (it || en) : en);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      const data = await api<{ access_token: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      onToken(data.access_token);
    } catch (e) {
      if (e instanceof Error && e.message) {
        setErr(e.message);
      } else {
        setErr(t.unauthorized);
      }
    }
  };

  return (
    <form className="card login-card" onSubmit={onSubmit}>
      <div className="login-grid">
        <label className="field">
          <span className="field-label">
            {t.username}
            <span className="tip-wrap" tabIndex={0} aria-label={L('Въведете вашето потребителско име.', 'Enter your username.', 'Inserisci il tuo nome utente.')}>
              <span className="tip" title={L('Въведете вашето потребителско име.', 'Enter your username.', 'Inserisci il tuo nome utente.')}>?</span>
              <span className="tip-popup">{L('Въведете вашето потребителско име.', 'Enter your username.', 'Inserisci il tuo nome utente.')}</span>
            </span>
          </span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">
            {t.password}
            <span className="tip-wrap" tabIndex={0} aria-label={L('Въведете паролата за този профил.', 'Enter the password for this account.', 'Inserisci la password di questo account.')}>
              <span className="tip" title={L('Въведете паролата за този профил.', 'Enter the password for this account.', 'Inserisci la password di questo account.')}>?</span>
              <span className="tip-popup">{L('Въведете паролата за този профил.', 'Enter the password for this account.', 'Inserisci la password di questo account.')}</span>
            </span>
          </span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
      </div>
      <div className="login-actions">
        <button>{t.login}</button>
      </div>
      {err && <div className="msg">{err}</div>}
    </form>
  );
}
