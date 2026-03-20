import type {HTMLAttributes, Ref} from 'react';

export function SandpackLayout({
  className,
  children,
  ref,
  ...rest
}: HTMLAttributes<HTMLDivElement> & {ref?: Ref<HTMLDivElement>}) {
  return (
    <div
      className={className ? `sp-layout ${className}` : 'sp-layout'}
      ref={ref}
      {...rest}>
      {children}
    </div>
  );
}
