import { cn } from '../../lib/utils';

export function Select({ className, children, ...props }) {
  return (
    <select className={cn('ep-select', className)} {...props}>
      {children}
    </select>
  );
}
