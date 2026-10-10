import { useEffect, useMemo, useState } from 'react';
import { Activity as ActivityIcon, ArrowDownLeft, ArrowUpRight, KeyRound, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { ProxyEvent, ProxyEventDetail } from '../../../shared/api';
import { Badge, Dot } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Dialog, DialogBody, DialogHeader, SheetContent } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const api = window.keybroker;

function StatusPill({ event }: { event: ProxyEvent }) {
  if (event.action === 'blocked')
    return (
      <Badge variant="destructive">
        <Dot />
        Blocked
      </Badge>
    );
  const ok = (event.status ?? 0) < 400;
  return (
    <Badge variant={ok ? 'success' : 'warning'}>
      <Dot />
      {event.status}
    </Badge>
  );
}

function prettyBody(body: string | undefined, contentType?: string): string | undefined {
  if (body === undefined) return undefined;
  if (contentType?.includes('json') || /^\s*[{[]/.test(body)) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      /* not JSON after all */
    }
  }
  return body;
}

function Section({ icon, title, meta, children }: { icon: React.ReactNode; title: string; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm font-semibold [&>svg]:size-3.5 [&>svg]:text-muted-foreground">
        {icon}
        {title}
        <span className="ml-auto font-normal text-muted-foreground">{meta}</span>
      </div>
      {children}
    </section>
  );
}

function Headers({ headers, injected }: { headers: Record<string, string>; injected?: string }) {
  const injectedHeader = injected?.startsWith('header ') ? injected.slice(7) : undefined;
  const rows = Object.entries(headers).filter(([k]) => k !== injectedHeader);
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full font-mono text-xs">
        <tbody>
          {injectedHeader && (
            <tr className="border-b bg-primary/6">
              <td className="w-[38%] px-2.5 py-1.5 align-top text-muted-foreground">{injectedHeader}</td>
              <td className="px-2.5 py-1.5">
                <span className="inline-flex items-center gap-1 font-sans text-xs text-primary">
                  <KeyRound className="size-3" />
                  added by Keybroker
                </span>
              </td>
            </tr>
          )}
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b last:border-0">
              <td className="w-[38%] px-2.5 py-1.5 align-top text-muted-foreground">{k}</td>
              <td className="break-all px-2.5 py-1.5">{v}</td>
            </tr>
          ))}
          {rows.length === 0 && !injectedHeader && (
            <tr>
              <td className="px-2.5 py-1.5 text-muted-foreground">No headers</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Body({ body, bytes, contentType, truncated }: { body?: string; bytes: number; contentType?: string; truncated?: boolean }) {
  const pretty = prettyBody(body, contentType);
  if (bytes === 0) return <p className="text-sm text-muted-foreground">Empty body</p>;
  if (pretty === undefined)
    return (
      <p className="text-sm text-muted-foreground">
        {bytes.toLocaleString()} bytes of {contentType ?? 'binary data'} (not shown)
      </p>
    );
  return (
    <pre className="max-h-80 overflow-auto rounded-lg border bg-background/50 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
      {pretty}
      {truncated && <span className="text-muted-foreground">{'\n'}… truncated</span>}
    </pre>
  );
}

function EventSheet({ event, onClose }: { event?: ProxyEvent; onClose(): void }) {
  const [detail, setDetail] = useState<ProxyEventDetail | null>();
  useEffect(() => {
    setDetail(undefined);
    if (event) api.eventDetail(event.id).then(setDetail);
  }, [event]);

  return (
    <Dialog open={Boolean(event)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        {event && (
          <>
            <DialogHeader
              title={
                <span className="flex items-center gap-2 font-mono text-lg">
                  <span className="text-primary">{event.method}</span>
                  <span className="truncate">
                    {event.host}
                    {event.path}
                  </span>
                </span>
              }
              description={`${new Date(event.time).toLocaleString()}${event.credential ? ` · via ${event.credential}` : ''}`}
            >
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusPill event={event} />
                {event.action === 'injected' && (
                  <Badge variant="default">
                    <ShieldCheck />
                    Key attached
                  </Badge>
                )}
                {(event.redactions ?? 0) > 0 && (
                  <Badge variant="warning">
                    <ShieldAlert />
                    {event.redactions} redacted from response
                  </Badge>
                )}
              </div>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-5">
              {event.reason && (
                <div className="rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2.5 text-sm text-destructive">{event.reason}</div>
              )}
              {detail === undefined && <div className="h-40 animate-pulse rounded-lg bg-muted" />}
              {detail === null && <p className="text-sm text-muted-foreground">Details for this request are no longer in memory.</p>}
              {detail && (
                <>
                  <Section icon={<ArrowUpRight />} title="Request" meta="as the agent sent it">
                    <div className="break-all rounded-lg bg-muted px-2.5 py-1.5 font-mono text-xs">
                      {detail.request.method} {detail.request.url}
                    </div>
                    <Headers headers={detail.request.headers} injected={detail.request.injectedAt} />
                    {detail.request.injectedAt?.startsWith('query ') && (
                      <p className="text-sm text-primary">Keybroker added the {detail.request.injectedAt.slice(6)} query parameter.</p>
                    )}
                    {detail.request.bodyBytes > 0 && (
                      <Body body={detail.request.body} bytes={detail.request.bodyBytes} contentType={detail.request.contentType} truncated={detail.request.bodyTruncated} />
                    )}
                  </Section>
                  {detail.response && (
                    <Section icon={<ArrowDownLeft />} title="Response" meta={`${detail.response.status} · ${detail.response.bodyBytes.toLocaleString()} bytes`}>
                      <Headers headers={detail.response.headers} />
                      <Body body={detail.response.body} bytes={detail.response.bodyBytes} contentType={detail.response.contentType} truncated={detail.response.bodyTruncated} />
                    </Section>
                  )}
                </>
              )}
            </DialogBody>
          </>
        )}
      </SheetContent>
    </Dialog>
  );
}

export function Activity({ events }: { events: ProxyEvent[] }) {
  const [selected, setSelected] = useState<ProxyEvent>();
  const rows = useMemo(() => events.slice(0, 200), [events]);

  return (
    <>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/12 text-primary">
              <ActivityIcon className="size-5" />
            </div>
            <div className="font-medium">No requests yet</div>
            <p className="max-w-sm text-sm text-muted-foreground">Requests that use one of your credentials show up here, live.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Time</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead>Request</TableHead>
                <TableHead className="w-32">Credential</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow
                  key={e.id}
                  data-state={selected?.id === e.id ? 'selected' : undefined}
                  className="cursor-default"
                  onClick={() => setSelected(e)}
                >
                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                    {new Date(e.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                  </TableCell>
                  <TableCell>
                    <StatusPill event={e} />
                  </TableCell>
                  <TableCell className="max-w-0">
                    <div className="truncate font-mono text-sm">
                      <span className={cn('mr-2 font-semibold', e.action === 'blocked' ? 'text-destructive' : 'text-primary')}>{e.method}</span>
                      {e.host}
                      <span className="text-muted-foreground">{e.path}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{e.credential ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <EventSheet event={selected} onClose={() => setSelected(undefined)} />
    </>
  );
}
