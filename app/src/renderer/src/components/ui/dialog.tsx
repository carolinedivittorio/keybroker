import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogClose = DialogPrimitive.Close;

function Overlay() {
  return <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px] data-[state=open]:animate-fade" />;
}

/** Centered modal. */
export function DialogContent({ className, children, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          'no-drag fixed left-1/2 top-[8vh] z-50 flex max-h-[84vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 flex-col rounded-xl border bg-popover shadow-glass backdrop-blur-2xl outline-none',
          'data-[state=open]:animate-pop',
          className,
        )}
        {...props}
      >
        {children}
        <CloseButton />
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Panel that slides in from the right, for details. */
export function SheetContent({ className, children, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          'no-drag fixed inset-y-2 right-2 z-50 flex w-[min(640px,calc(100%-3rem))] flex-col rounded-xl border bg-popover shadow-glass backdrop-blur-2xl outline-none',
          'data-[state=open]:animate-slide',
          className,
        )}
        {...props}
      >
        {children}
        <CloseButton />
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function CloseButton() {
  return (
    <DialogPrimitive.Close className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring">
      <X className="size-4" />
      <span className="sr-only">Close</span>
    </DialogPrimitive.Close>
  );
}

export function DialogHeader({ title, description, children }: { title: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b px-5 pb-4 pt-5 pr-12">
      <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">{title}</DialogPrimitive.Title>
      {description ? (
        <DialogPrimitive.Description className="text-base text-muted-foreground">{description}</DialogPrimitive.Description>
      ) : (
        <DialogPrimitive.Description className="sr-only">{String(title)}</DialogPrimitive.Description>
      )}
      {children}
    </div>
  );
}

export const DialogBody = ({ className, ...props }: ComponentProps<'div'>) => (
  <div className={cn('flex-1 overflow-y-auto px-5 py-4', className)} {...props} />
);

export const DialogFooter = ({ className, ...props }: ComponentProps<'div'>) => (
  <div className={cn('flex items-center justify-end gap-2 border-t px-5 py-3', className)} {...props} />
);
