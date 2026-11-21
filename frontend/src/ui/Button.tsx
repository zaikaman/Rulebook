import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cx } from './classNames.js';

export type ButtonVariant = 'secondary' | 'primary' | 'quiet' | 'danger' | 'danger-solid';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
}

/** The one button recipe. Feature code supplies intent, never its own app-button classes. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('app-button', variant !== 'secondary' && `app-button--${variant}`, className)}
      {...props}
    />
  );
});
