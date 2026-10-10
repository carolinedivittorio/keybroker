import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;
export const TabsContent = ({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) => (
  <TabsPrimitive.Content className={cn('outline-none', className)} {...props} />
);
export const TabsList = ({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List className={cn('glass inline-flex h-9 items-center gap-0.5 rounded-lg p-[3px]', className)} {...props} />
);
export const TabsTrigger = ({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) => (
  <TabsPrimitive.Trigger
    className={cn(
      'inline-flex h-full items-center gap-1.5 rounded-md px-3 text-base font-medium text-muted-foreground transition-all outline-none cursor-default',
      'hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring [&_svg]:size-3.5',
      'data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-[0_1px_0_0_var(--highlight)_inset,0_1px_3px_0_oklch(0_0_0/0.12)]',
      className,
    )}
    {...props}
  />
);
