import type {
  AdminStudentProfile,
  ProfileConsentRequest,
} from '@event-registration/contracts';
import { useEffect, useState, type FormEvent } from 'react';

import { adminApi } from './admin-api.js';

const publicationFields = [
  ['NAME', 'Фамилия и инициалы'],
  ['STUDY_GROUP', 'Группа'],
  ['PARTICIPATIONS', 'Участие в мероприятиях'],
  ['ACHIEVEMENTS', 'Достижения'],
  ['SCORES', 'Баллы и начисления'],
] as const;

export const AdminMosActivePublication = ({
  personId,
}: {
  personId: string;
}) => {
  const [profile, setProfile] = useState<AdminStudentProfile>();
  const [selectedFields, setSelectedFields] = useState<
    ProfileConsentRequest['allowedFields']
  >(publicationFields.map(([field]) => field));
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    adminApi
      .studentProfile(personId)
      .then((value) => {
        if (!cancelled) {
          setProfile(value);
          if (value.consent) {
            setVersion(value.consent.consentVersion);
            setSelectedFields(value.consent.allowedFields);
          }
        }
      })
      .catch(() => {
        if (!cancelled)
          setMessage('Не удалось загрузить настройки публикации.');
      });
    return () => {
      cancelled = true;
    };
  }, [personId]);

  const saveConsent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    try {
      setProfile(
        await adminApi.grantProfileConsent(personId, {
          consentVersion: version.trim(),
          allowedFields: selectedFields,
          source: 'ADMIN',
        }),
      );
      setMessage(
        'Сведения о согласии сохранены. Проверьте профиль перед публикацией.',
      );
    } catch {
      setMessage(
        'Не удалось сохранить согласие. Проверьте версию и выбранные поля.',
      );
    } finally {
      setBusy(false);
    }
  };

  const changeVisibility = async (visibility: 'PRIVATE' | 'PUBLIC') => {
    setBusy(true);
    setMessage(undefined);
    try {
      setProfile(await adminApi.setProfileVisibility(personId, visibility));
      setMessage(
        visibility === 'PUBLIC'
          ? 'Профиль опубликован.'
          : 'Профиль снят с публикации.',
      );
    } catch {
      setMessage('Не удалось изменить видимость профиля.');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      await adminApi.withdrawProfileConsent(personId);
      setProfile(await adminApi.studentProfile(personId));
      setMessage('Согласие отозвано, профиль скрыт.');
    } catch {
      setMessage('Не удалось отозвать согласие.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="admin-panel mos-active-publication">
      <h2>Публикация в МосАктиве</h2>
      <p>
        В открытом профиле показываются только выбранные сведения. Запишите
        данные подписанного согласия перед публикацией.
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
          <form onSubmit={(event) => void saveConsent(event)}>
            <label htmlFor="publication-consent-version">
              Версия подписанного согласия
            </label>
            <input
              id="publication-consent-version"
              value={version}
              maxLength={100}
              required
              onChange={(event) => setVersion(event.target.value)}
              disabled={busy}
            />
            <fieldset>
              <legend>Разрешённые для публикации сведения</legend>
              {publicationFields.map(([field, label]) => (
                <label key={field}>
                  <input
                    type="checkbox"
                    checked={selectedFields.includes(field)}
                    disabled={busy}
                    onChange={(event) =>
                      setSelectedFields((current) =>
                        event.target.checked
                          ? [...current, field]
                          : current.filter((value) => value !== field),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <label>
              <input type="checkbox" required />
              Подтверждаю наличие подписанного согласия на публикацию выбранных
              сведений.
            </label>
            <button
              type="submit"
              disabled={busy || selectedFields.length === 0}
            >
              Сохранить согласие
            </button>
          </form>
          <div className="row-actions">
            {profile.visibility === 'PUBLIC' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void changeVisibility('PRIVATE')}
              >
                Скрыть профиль
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || !profile.consent}
                onClick={() => void changeVisibility('PUBLIC')}
              >
                Опубликовать профиль
              </button>
            )}
            {profile.consent && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void withdraw()}
              >
                Отозвать согласие и скрыть
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
};
