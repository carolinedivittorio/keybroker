import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity as ActivityIcon, AlertTriangle, ArrowUpCircle, KeyRound, Plug, Sparkles } from 'lucide-react';
import type { Preset } from '@keybroker/core';
import type { BrokerStatus, CredentialView, Proposal, ProxyEvent, UpdateState } from '../../shared/api';
import { CredentialForm } from './CredentialForm';
import { Activity } from './tabs/Activity';
import { Connections } from './tabs/Connections';
import { Credentials } from './tabs/Credentials';
import { Badge, Dot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import iconUrl from '../../../../assets/icon.svg';

const api = window.keybroker;

type Tab = 'connections' | 'credentials' | 'activity';

/** Soft colour behind the glass so the frosted panels have something to refract. */
function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background">
      <div className="absolute -left-32 -top-40 size-[520px] rounded-full bg-[oklch(0.62_0.15_242.7/0.28)] blur-[110px] dark:bg-[oklch(0.5_0.15_242.7/0.35)]" />
      <div className="absolute -right-24 top-1/3 size-[420px] rounded-full bg-[oklch(0.85_0.12_80/0.25)] blur-[110px] dark:bg-[oklch(0.6_0.12_70/0.18)]" />
      <div className="absolute -bottom-40 left-1/4 size-[460px] rounded-full bg-[oklch(0.75_0.1_200/0.2)] blur-[120px] dark:bg-[oklch(0.45_0.1_220/0.25)]" />
    </div>
  );
}

export function App() {
  const [status, setStatus] = useState<BrokerStatus>();
  const [credentials, setCredentials] = useState<CredentialView[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [events, setEvents] = useState<ProxyEvent[]>([]);
  const [editing, setEditing] = useState<CredentialView | 'new'>();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [reviewing, setReviewing] = useState<Proposal>();
  const [tab, setTab] = useState<Tab>('connections');
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' });

  const reload = useCallback(async () => {
    setCredentials(await api.listCredentials());
    setStatus(await api.status());
  }, []);

  useEffect(() => {
    reload();
    api.presets().then(setPresets);
    api.recentEvents().then((e) => setEvents([...e].reverse()));
    const offEvents = api.onEvent((e) => setEvents((prev) => [e, ...prev].slice(0, 200)));
    const loadProposals = async () => {
      const pending = await api.pendingProposals();
      setProposals(pending);
      // Open the newest proposal straight away, whatever tab is showing, unless one is already open.
      setReviewing((current) => (current && pending.some((p) => p.id === current.id) ? current : pending.at(-1)));
      reload();
    };
    loadProposals();
    const offProposals = api.onProposalsChanged(loadProposals);
    api.updateState().then(setUpdate);
    const offUpdate = api.onUpdateState(setUpdate);
    return () => {
      offEvents();
      offProposals();
      offUpdate();
    };
  }, [reload]);

  const lastUsed = useMemo(() => {
    const out: Record<string, string> = {};
    for (const e of events) if (e.credential && e.action === 'injected' && !out[e.credential]) out[e.credential] = e.time;
    return out;
  }, [events]);

  const proxyOk = Boolean(status?.proxyUrl) && !status?.error;

  return (
    <div className="flex min-h-screen flex-col">
      <Backdrop />

      {/* No native title bar: this row is the drag handle. Left padding clears the traffic lights. */}
      <header className="drag sticky top-0 z-30 flex h-[52px] items-center gap-3 border-b bg-background/40 pl-[84px] pr-4 backdrop-blur-xl">
        <img src={iconUrl} alt="" className="size-6 drop-shadow-sm" />
        <div className="text-base font-semibold tracking-tight">Keybroker</div>
        <div className="no-drag ml-auto">
          {status && (
            <Badge variant={proxyOk ? 'success' : 'destructive'} className="font-mono">
              <Dot className={proxyOk ? 'animate-pulse' : ''} />
              {proxyOk ? `proxy ${status.proxyUrl.replace('http://', '')}` : 'proxy error'}
            </Badge>
          )}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-6 pb-8 pt-5">
        {status?.error && (
          <div className="glass flex items-center gap-2.5 rounded-xl px-4 py-3 text-sm text-destructive">
            <AlertTriangle className="size-4" />
            {status.error}
          </div>
        )}
        {status?.devBuild && (
          <div className="glass flex items-center gap-2.5 rounded-xl px-4 py-3 text-sm text-warning">
            <AlertTriangle className="size-4 shrink-0" />
            <span>
              <strong>Development build.</strong> Other programs on this Mac can read keys stored here. Use test keys only.
            </span>
          </div>
        )}

        {update.status === 'ready' && (
          <div className="glass flex items-center gap-3 rounded-xl px-4 py-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
              <ArrowUpCircle className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium">Keybroker {update.version} is ready</div>
              <div className="text-sm text-muted-foreground">Restart to finish updating. It also installs the next time you quit.</div>
            </div>
            <Button size="sm" onClick={() => api.installUpdate()}>
              Restart to update
            </Button>
          </div>
        )}

        {proposals.length > 0 && (
          <div className="glass flex items-center gap-3 rounded-xl border-primary/30 px-4 py-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-base font-medium">
                {proposals.length === 1 ? 'An agent proposed a credential' : `${proposals.length} proposed credentials`}
              </div>
              <div className="truncate text-sm text-muted-foreground">
                {proposals.map((p) => `${p.name} → ${p.hosts.join(', ')}`).join(' · ')}
              </div>
            </div>
            <Button size="sm" onClick={() => setReviewing(proposals.at(-1))}>
              Review
            </Button>
          </div>
        )}

        <Tabs value={tab} onValueChange={(next) => setTab(next as Tab)} className="flex flex-col gap-4">
          <TabsList className="self-start">
            <TabsTrigger value="connections">
              <Plug />
              Connections
            </TabsTrigger>
            <TabsTrigger value="credentials">
              <KeyRound />
              Credentials
              <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{credentials.length}</span>
            </TabsTrigger>
            <TabsTrigger value="activity">
              <ActivityIcon />
              Activity
            </TabsTrigger>
          </TabsList>

          <TabsContent value="connections">
            <Connections status={status} />
          </TabsContent>
          <TabsContent value="credentials">
            <Credentials credentials={credentials} lastUsed={lastUsed} onAdd={() => setEditing('new')} onView={setEditing} onChanged={reload} />
          </TabsContent>
          <TabsContent value="activity">
            <Activity events={events} />
          </TabsContent>
        </Tabs>
      </main>

      {reviewing && !editing && (
        <CredentialForm
          key={reviewing.id}
          proposal={reviewing}
          presets={presets}
          takenNames={credentials.map((c) => c.name)}
          onClose={() => setReviewing(undefined)}
          onSaved={() => {
            setReviewing(undefined);
            reload();
          }}
        />
      )}

      {editing && (
        <CredentialForm
          existing={editing === 'new' ? undefined : editing}
          presets={presets}
          takenNames={credentials.map((c) => c.name)}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            reload();
          }}
        />
      )}
    </div>
  );
}
