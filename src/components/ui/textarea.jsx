import { cn } from '../../lib/utils';

export function Textarea({ className, ...props }) {
  return <textarea className={cn('ep-textarea', className)} {...props} />;
}
