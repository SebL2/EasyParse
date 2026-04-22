import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva('ep-badge', {
  variants: {
    variant: {
      default: 'ep-badge-default',
      secondary: 'ep-badge-secondary',
      success: 'ep-badge-success',
      warning: 'ep-badge-warning',
      outline: 'ep-badge-outline',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
