import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Eye, MoreVertical, Pause, Play, Plug, Terminal, Unplug } from 'lucide-react';
import type { BrokerStatus, IntegrationView } from '../../../shared/api';
import { Badge, Dot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogBody, DialogFooter, DialogHeader, SheetContent } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const api = window.keybroker;

function ShellSetup({ status }: { status?: BrokerStatus }) {
  const [copied, setCopied] = useState(false);
  const command = status ? `source ${status.envFile}` : '';
  return (
    <Card className="flex items-center gap-4 p-4">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
        <Terminal className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">Use your keys in a terminal</div>
        <div className="text-sm text-muted-foreground">Run this in a terminal so commands there can use your keys. Claude Code does this automatically.</div>
      </div>
      <button
        className="no-drag group flex shrink-0 items-center gap-2 rounded-md border bg-background/60 py-1.5 pl-3 pr-2 font-mono text-sm shadow-[0_1px_0_0_var(--highlight)_inset] hover:bg-accent"
        onClick={async () => {
          await api.copy(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {command.replace(/^source \/Users\/[^/]+/, 'source ~')}
        <span className="rounded p-0.5 text-muted-foreground group-hover:text-foreground">
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
        </span>
      </button>
    </Card>
  );
}

function StatusBadge({ item }: { item: IntegrationView }) {
  if (!item.detected) return <span className="text-sm text-muted-foreground">Not installed</span>;
  if (!item.installed) return null;
  if (item.paused)
    return (
      <Badge variant="warning">
        <Dot />
        Paused
      </Badge>
    );
  return (
    <Badge variant="success">
      <Dot />
      Connected
    </Badge>
  );
}

function DetailList({ title, items, mono }: { title: string; items: string[]; mono?: boolean }) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <div className="text-sm font-semibold">{title}</div>
      <ul className="flex flex-col gap-1.5">
        {items.map((i) =>
          mono ? (
            <li key={i} className="break-all rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">
              {i}
            </li>
          ) : (
            <li key={i} className="flex gap-2">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground" />
              {i}
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

export function Connections({ status }: { status?: BrokerStatus }) {
  const [items, setItems] = useState<IntegrationView[]>();
  const [busy, setBusy] = useState<string>();
  const [viewing, setViewing] = useState<string>();
  const [error, setError] = useState<{ id: string; message: string }>();

  const load = useCallback(async () => setItems(await api.integrations()), []);
  useEffect(() => {
    load();
    // Some installs finish in the other app (e.g. Claude Desktop's dialog); recheck on return.
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  async function act(item: IntegrationView, fn: () => Promise<unknown>) {
    setBusy(item.id);
    setError(undefined);
    const result = (await fn()) as { ok: boolean; error?: string } | undefined;
    if (result && !result.ok) setError({ id: item.id, message: result.error ?? 'Something went wrong' });
    await load();
    setBusy(undefined);
  }
  const connect = (item: IntegrationView) => act(item, () => api.setIntegration(item.id, true));
  const remove = (item: IntegrationView) => act(item, () => api.setIntegration(item.id, false));
  const togglePause = (item: IntegrationView) => act(item, () => api.pauseIntegration(item.id, !item.paused));

  const selected = items?.find((i) => i.id === viewing);

  return (
    <div className="flex flex-col gap-4">
      <ShellSetup status={status} />
      <div className="flex flex-col gap-2">
        {!items &&
          [0, 1, 2, 3].map((i) => (
            <Card key={i} className="h-[58px] animate-pulse" />
          ))}
        {items?.map((item) => (
          <Card
            key={item.id}
            role="button"
            tabIndex={0}
            className="flex cursor-default items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring outline-none"
            onClick={() => setViewing(item.id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setViewing(item.id)}
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium">{item.name}</div>
              {error?.id === item.id && <div className="mt-0.5 text-sm text-destructive">{error.message}</div>}
            </div>
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <StatusBadge item={item} />
              {item.detected && !item.installed && (
                <Button size="sm" disabled={busy !== undefined} onClick={() => connect(item)}>
                  <Plug />
                  {busy === item.id ? 'Connecting…' : 'Connect'}
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${item.name}`} disabled={busy === item.id}>
                    <MoreVertical />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setViewing(item.id)}>
                    <Eye />
                    View details
                  </DropdownMenuItem>
                  {item.installed && (
                    <>
                      <DropdownMenuItem onSelect={() => togglePause(item)}>
                        {item.paused ? <Play /> : <Pause />}
                        {item.paused ? 'Resume' : 'Pause'}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {item.removeHint ? (
                        // Removed in the agent's own app; the details panel says where.
                        <DropdownMenuItem onSelect={() => setViewing(item.id)}>
                          <Unplug />
                          Remove…
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem variant="destructive" onSelect={() => remove(item)}>
                          <Unplug />
                          Remove
                        </DropdownMenuItem>
                      )}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setViewing(undefined)}>
        <SheetContent className="w-[min(480px,calc(100%-3rem))]">
          {selected && (
            <>
              <DialogHeader title={selected.name} description={selected.note}>
                {selected.installed && (
                  <div className="mt-2">
                    <StatusBadge item={selected} />
                  </div>
                )}
              </DialogHeader>
              <DialogBody className="flex flex-col gap-5">
                <DetailList title="What Keybroker adds" items={selected.gives} />
                <DetailList title={`Not available for ${selected.name}`} items={selected.missing} />
                <DetailList title={selected.installed ? 'What connecting changed' : 'What connecting changes'} items={selected.changes} mono />
                {selected.installed && selected.removeHint && <p className="text-sm text-muted-foreground">{selected.removeHint}</p>}
              </DialogBody>
              {selected.detected && (
                <DialogFooter>
                  {!selected.installed && (
                    <Button disabled={busy !== undefined} onClick={() => connect(selected)}>
                      <Plug />
                      {busy === selected.id ? 'Connecting…' : 'Connect'}
                    </Button>
                  )}
                  {selected.installed && (
                    <>
                      {!selected.removeHint && (
                        <Button variant="ghost" className="mr-auto text-destructive" disabled={busy !== undefined} onClick={() => remove(selected)}>
                          <Unplug />
                          Remove
                        </Button>
                      )}
                      <Button variant="outline" disabled={busy !== undefined} onClick={() => togglePause(selected)}>
                        {selected.paused ? <Play /> : <Pause />}
                        {selected.paused ? 'Resume' : 'Pause'}
                      </Button>
                    </>
                  )}
                </DialogFooter>
              )}
            </>
          )}
        </SheetContent>
      </Dialog>
    </div>
  );
}
