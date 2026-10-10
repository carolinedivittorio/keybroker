import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const Card = ({ className, ...props }: ComponentProps<'div'>) => <div className={cn('glass rounded-xl', className)} {...props} />;
