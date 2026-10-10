import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3',
  {
    variants: {
      variant: {
        default: 'bg-primary/12 text-primary',
        success: 'bg-success/14 text-success',
        warning: 'bg-warning/16 text-warning',
        destructive: 'bg-destructive/12 text-destructive',
        muted: 'bg-muted text-muted-foreground',
        outline: 'border border-border text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Badge({ className, variant, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** Small status dot used inside badges. */
export function Dot({ className }: { className?: string }) {
  return <span className={cn('size-1.5 rounded-full bg-current', className)} />;
}
