import type { ButtonHTMLAttributes } from 'react';
export {
  RegistrationSystemFields,
  ConsentCheckbox,
  BooleanQuestion,
} from './registration-fields.js';

export const Button = ({
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    className={`kait-button ${className}`.trim()}
    type={type}
    {...props}
  />
);
