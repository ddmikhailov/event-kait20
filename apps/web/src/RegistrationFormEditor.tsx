import { useRef, useState } from 'react';
import {
  defaultSystemFields,
  systemFieldLabels,
  type EventResponse,
  type RegistrationFormConfig,
  type SystemFields,
} from '@event-registration/contracts';
import {
  Button,
  RegistrationSystemFields,
  ConsentCheckbox,
} from '@event-registration/ui';
import { adminApi } from './admin-api.js';

export const RegistrationFormEditor = ({
  event,
  onSaved,
}: {
  event: EventResponse;
  onSaved: (event: EventResponse) => void;
}) => {
  const initial = event.formConfig ?? {
    public: defaultSystemFields('public', true),
    onsite: defaultSystemFields('onsite', true),
  };
  const [config, setConfig] = useState<RegistrationFormConfig>(initial);
  const [mode, setMode] = useState<'public' | 'onsite'>('public');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const archived = event.status === 'ARCHIVED';
  const change = (fields: SystemFields) => {
    setConfig((previous) => ({ ...previous, [mode]: fields }));
    setNotice('');
  };
  const move = (index: number, offset: number) => {
    const fields = [...config[mode]];
    const other = index + offset;
    if (!fields[index] || !fields[other]) return;
    [fields[index], fields[other]] = [fields[other], fields[index]];
    change(fields);
  };
  const save = async () => {
    if (lock.current || archived) return;
    lock.current = true;
    setBusy(true);
    setNotice('');
    try {
      const saved = await adminApi.updateEvent(event.id, {
        formConfig: config,
      });
      onSaved(saved);
      setNotice('Настройки формы сохранены.');
    } catch {
      setNotice(
        'Не удалось сохранить настройки. Проверьте соединение и повторите попытку. Ваши изменения остались в форме.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="registration-constructor">
      <h2>Конструктор регистрации</h2>
      <p>
        Фамилия, имя и согласие обязательны всегда. Для остальных данных
        выберите, показывать ли поле и нужен ли ответ. Порядок можно изменить
        стрелками.
      </p>
      <div className="row-actions" role="group" aria-label="Вариант формы">
        <button
          type="button"
          className="secondary-button"
          aria-pressed={mode === 'public'}
          onClick={() => setMode('public')}
        >
          На сайте
        </button>
        <button
          type="button"
          className="secondary-button"
          aria-pressed={mode === 'onsite'}
          onClick={() => setMode('onsite')}
        >
          На месте
        </button>
      </div>
      <fieldset disabled={busy || archived}>
        <legend>
          {mode === 'public'
            ? 'Публичная регистрация'
            : 'Регистрация организатором или сканировщиком'}
        </legend>
        {config[mode].map((field, index) => (
          <div className="constructor-row" key={field.key}>
            <label>
              {systemFieldLabels[field.key]}
              <select
                aria-label={systemFieldLabels[field.key]}
                value={field.mode}
                onChange={(e) =>
                  change(
                    config[mode].map((item) =>
                      item.key === field.key
                        ? { ...item, mode: e.target.value as typeof field.mode }
                        : item,
                    ),
                  )
                }
              >
                <option value="OPTIONAL">Необязательно</option>
                <option value="REQUIRED">Обязательно</option>
                <option value="HIDDEN">Не показывать</option>
              </select>
            </label>
            <button
              type="button"
              className="secondary-button"
              aria-label={`Выше: ${systemFieldLabels[field.key]}`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="secondary-button"
              aria-label={`Ниже: ${systemFieldLabels[field.key]}`}
              disabled={index === config[mode].length - 1}
              onClick={() => move(index, 1)}
            >
              ↓
            </button>
          </div>
        ))}
        <p className="muted">
          Группа показывается только студентам КАИТ, организация — участникам из
          других организаций. Если мероприятие ограничено по статусу участника,
          выбор статуса обязателен независимо от этой настройки. Без email билет
          нужно сохранить с экрана.
        </p>
        <Button
          type="button"
          disabled={busy || archived}
          onClick={() => void save()}
        >
          {busy ? 'Сохраняем…' : 'Сохранить настройки формы'}
        </Button>
      </fieldset>
      {notice && <p role="status">{notice}</p>}
      <details>
        <summary>Предварительный просмотр</summary>
        <p className="muted">
          Это образец: данные не отправляются. Дополнительные вопросы
          настраиваются ниже.
        </p>
        <RegistrationSystemFields
          key={mode}
          fields={config[mode]}
          allowedTypes={event.allowedPersonTypes}
        />
        <ConsentCheckbox onsite={mode === 'onsite'} />
      </details>
    </section>
  );
};
