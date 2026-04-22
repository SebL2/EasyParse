import { cn } from '../../lib/utils';

export function Card({ className, ...props }) {
  return <div className={cn('ep-card', className)} {...props} />;
}

export function CardHeader({ className, ...props }) {
  return <div className={cn('ep-card-header', className)} {...props} />;
}

export function CardTitle({ className, ...props }) {
  return <div className={cn('ep-card-title', className)} {...props} />;
}

export function CardDescription({ className, ...props }) {
  return <div className={cn('ep-card-description', className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <div className={cn('ep-card-content', className)} {...props} />;
}
