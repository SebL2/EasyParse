import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva('ep-button', {
  variants: {
    variant: {
      default: 'ep-button-default',
      primary: 'ep-button-primary',
      secondary: 'ep-button-secondary',
      ghost: 'ep-button-ghost',
      danger: 'ep-button-danger',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export function Button({ className, variant, ...props }) {
  return <button className={cn(buttonVariants({ variant }), className)} {...props} />;
}
