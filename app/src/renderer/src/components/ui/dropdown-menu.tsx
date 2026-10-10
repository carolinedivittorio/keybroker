import * as Menu from '@radix-ui/react-dropdown-menu';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-40 rounded-lg border bg-popover p-1 text-foreground shadow-glass backdrop-blur-2xl',
          'data-[state=open]:animate-menu',
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  );
}

export function DropdownMenuItem({ className, variant, ...props }: ComponentProps<typeof Menu.Item> & { variant?: 'destructive' }) {
  return (
    <Menu.Item
      className={cn(
        'relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-base outline-none [&_svg]:size-3.5 [&_svg]:text-muted-foreground',
        'data-[highlighted]:bg-accent',
        variant === 'destructive' && 'text-destructive [&_svg]:!text-destructive data-[highlighted]:bg-destructive/10',
        className,
      )}
      {...props}
    />
  );
}

export const DropdownMenuSeparator = ({ className, ...props }: ComponentProps<typeof Menu.Separator>) => (
  <Menu.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
);
