'use client';

import { useEffect, useState } from 'react';

import Dashboard from '@/components/Dashboard';
import LoginForm from '@/components/LoginForm';
import { api } from '@/lib/api';
import { Lang, texts } from '@/lib/i18n';

export default function HomePage() {
  const [lang, setLang] = useState<Lang>('bg');
  const [token, setToken] = useState('');
  const [booting, setBooting] = useState(true);
  const tokenKey = 'openstoko_token';
  const legacyTokenKey = 'smartstock_token';
  const t = texts[lang];

  useEffect(() => {
    const savedToken = localStorage.getItem(tokenKey) || localStorage.getItem(legacyTokenKey);
    if (!savedToken) {
      setBooting(false);
      return;
    }

    (async () => {
      try {
        await api('/auth/me', {}, savedToken);
        setToken(savedToken);
        localStorage.setItem(tokenKey, savedToken);
        localStorage.removeItem(legacyTokenKey);
      } catch {
        setToken('');
        localStorage.removeItem(tokenKey);
        localStorage.removeItem(legacyTokenKey);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  const handleToken = (value: string) => {
    setToken(value);
    localStorage.setItem(tokenKey, value);
  };

  const handleLogout = () => {
    setToken('');
    localStorage.removeItem(tokenKey);
  };

  return (
    <main className="container">
      <div className="topbar">
        <div>
          <h1>{texts[lang].title}</h1>
          <div className="muted">{texts[lang].tagline}</div>
        </div>
        <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} style={{ maxWidth: 180 }}>
          <option value="bg">{t.langBulgarian}</option>
          <option value="en">{t.langEnglish}</option>
          <option value="it">{t.langItalian}</option>
        </select>
      </div>
      {booting ? (
        <div className="card"><div className="muted">{t.loadingSession}</div></div>
      ) : !token ? (
        <LoginForm lang={lang} onToken={handleToken} />
      ) : (
        <Dashboard lang={lang} token={token} onLogout={handleLogout} />
      )}
      <div className="muted" style={{ marginTop: 8 }}>
        {t.licenseNotice} | <a href="/LICENSE.txt" target="_blank" rel="noreferrer">{t.viewLicense}</a>
      </div>
    </main>
  );
}
