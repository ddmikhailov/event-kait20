import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaultSystemFields } from '@event-registration/contracts';
import {
  ConsentCheckbox,
  RegistrationSystemFields,
} from './registration-fields.js';

describe('shared registration constructor', () => {
  it('requires names but leaves configurable data optional by default', () => {
    const html = renderToStaticMarkup(
      <RegistrationSystemFields fields={defaultSystemFields('public')} />,
    );
    expect(html.match(/required=""/g)).toHaveLength(2);
    expect(html).toContain('name="email"');
    expect(html).not.toContain('name="studyGroup"');
  });
  it('hides configured fields but always asks for category on restricted events', () => {
    const fields = defaultSystemFields('onsite').map((field) => ({
      ...field,
      mode: 'HIDDEN' as const,
    }));
    const html = renderToStaticMarkup(
      <RegistrationSystemFields fields={fields} allowedTypes={['PARENT']} />,
    );
    expect(html).not.toContain('name="phone"');
    expect(html).toContain('name="personType" required=""');
    expect(html).toContain('Выберите статус');
  });
  it('never prechecks consent in public or onsite forms', () => {
    for (const onsite of [false, true]) {
      const html = renderToStaticMarkup(<ConsentCheckbox onsite={onsite} />);
      expect(html).toContain('required=""');
      expect(html).not.toContain('checked');
      expect(html).toContain(
        'https://static.mskobr.ru/docs/soglasie_na_obrabotku_pnd.pdf',
      );
    }
  });
});
