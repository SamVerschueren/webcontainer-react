import type {HTMLAttributes, Ref} from 'react';

export function SandpackStack({
  className,
  children,
  ref,
  ...rest
}: HTMLAttributes<HTMLDivElement> & {ref?: Ref<HTMLDivElement>}) {
  return (
    <div
      className={className ? `sp-stack ${className}` : 'sp-stack'}
      ref={ref}
      {...rest}>
      {children}
    </div>
  );
}
