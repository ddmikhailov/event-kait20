import type { AdminStudentProfile } from '@event-registration/contracts';
import { useEffect, useState } from 'react';

import { adminApi } from './admin-api.js';

export const AdminMosActivePublication = ({
  personId,
}: {
  personId: string;
}) => {
  const [profile, setProfile] = useState<AdminStudentProfile>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    adminApi
      .studentProfile(personId)
      .then((value) => {
        if (!cancelled) setProfile(value);
      })
      .catch(() => {
        if (!cancelled)
          setMessage('Не удалось загрузить настройки публикации.');
      });
    return () => {
      cancelled = true;
    };
  }, [personId]);

  const changeVisibility = async (visibility: 'PRIVATE' | 'PUBLIC') => {
    setBusy(true);
    setMessage(undefined);
    try {
      setProfile(await adminApi.setProfileVisibility(personId, visibility));
      setMessage(
        visibility === 'PUBLIC' ? 'Профиль опубликован.' : 'Профиль скрыт.',
      );
    } catch {
      setMessage('Не удалось изменить видимость профиля.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="admin-panel mos-active-publication">
      <h2>Публикация в МосАктиве</h2>
      <p>
        В открытой карточке видны фамилия и инициалы, группа, площадка и
        мероприятия с начисленными баллами. В рейтинге показываются имя и сумма
        баллов за сезон.
      </p>
      {message && <p role="status">{message}</p>}
      {!profile && !message && <p>Загружаем настройки…</p>}
      {profile && (
        <>
          <p>
            Статус: {profile.visibility === 'PUBLIC' ? 'опубликован' : 'скрыт'}
          </p>
          {profile.visibility === 'PUBLIC' && profile.publicSlug && (
            <a
              href={`/mos-active/students/${encodeURIComponent(profile.publicSlug)}`}
            >
              Открыть публичный профиль
            </a>
          )}
          <div className="row-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void changeVisibility(
                  profile.visibility === 'PUBLIC' ? 'PRIVATE' : 'PUBLIC',
                )
              }
            >
              {profile.visibility === 'PUBLIC'
                ? 'Скрыть профиль'
                : 'Опубликовать профиль'}
            </button>
          </div>
        </>
      )}
    </section>
  );
};
