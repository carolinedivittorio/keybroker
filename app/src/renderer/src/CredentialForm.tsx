import { useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, ExternalLink, KeyRound, ShieldCheck, Sparkles } from 'lucide-react';
import type { AuthScheme, Preset } from '@keybroker/core';
// Deep import: the package index pulls in Node-only modules.
import { isWithinDomain } from '@keybroker/core/src/hosts';
import type { CredentialInput, CredentialView, Proposal } from '../../shared/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const api = window.keybroker;

type AuthType = AuthScheme['type'];

interface Props {
  existing?: CredentialView;
  /** Set when reviewing an agent's proposal: pre-fills the form and approves on save. */
  proposal?: Proposal;
  presets: Preset[];
  takenNames: string[];
  onClose(): void;
  onSaved(): void;
}

interface FormState {
  name: string;
  hosts: string;
  authType: AuthType;
  header: string;
  prefix: string;
  param: string;
  username: string;
  envVar: string;
  docsUrl: string;
  notes: string;
}

function toForm(c?: CredentialInput): FormState {
  const auth = c?.auth ?? { type: 'bearer' };
  return {
    name: c?.name ?? '',
    hosts: c?.hosts.join(', ') ?? '',
    authType: auth.type,
    header: auth.type === 'header' ? auth.header : '',
    prefix: auth.type === 'header' ? (auth.prefix ?? '') : '',
    param: auth.type === 'query' ? auth.param : '',
    username: auth.type === 'basic' ? (auth.username ?? '') : '',
    envVar: c?.envVar ?? '',
    docsUrl: c?.docsUrl ?? '',
    notes: c?.notes ?? '',
  };
}

function toInput(f: FormState): CredentialInput {
  const auth: AuthScheme =
    f.authType === 'header'
      ? { type: 'header', header: f.header.trim(), ...(f.prefix ? { prefix: f.prefix } : {}) }
      : f.authType === 'query'
        ? { type: 'query', param: f.param.trim() }
        : f.authType === 'basic'
          ? { type: 'basic', ...(f.username.trim() ? { username: f.username.trim() } : {}) }
          : { type: 'bearer' };
  return {
    name: f.name.trim().toLowerCase(),
    hosts: f.hosts
      .split(/[\s,]+/)
      .map((h) => h.trim())
      .filter(Boolean),
    auth,
    envVar: f.envVar.trim() || undefined,
    docsUrl: f.docsUrl.trim() || undefined,
    notes: f.notes.trim() || undefined,
  };
}

function Callout({ tone, icon, children }: { tone: 'good' | 'warn' | 'info'; icon: ReactNode; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm leading-relaxed [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
        tone === 'good' && 'border-success/25 bg-success/8 text-success',
        tone === 'warn' && 'border-warning/30 bg-warning/10 text-warning',
        tone === 'info' && 'border-primary/20 bg-primary/8 text-foreground',
      )}
    >
      {icon}
      <div>{children}</div>
    </div>
  );
}

export function CredentialForm({ existing, proposal, presets, takenNames, onClose, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(() => toForm(existing ?? proposal));
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const isEdit = Boolean(existing);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const docsHost = (() => {
    try {
      return form.docsUrl ? new URL(form.docsUrl).hostname.replace(/^www\./, '') : undefined;
    } catch {
      return undefined;
    }
  })();
  // Compare against the docs' registrable-ish domain (last two labels), dot-bounded.
  const docsDomain = docsHost?.split('.').slice(-2).join('.');
  const hostList = toInput(form).hosts;
  const hostsOffDocsDomain = docsDomain && hostList.some((h) => !isWithinDomain(h, docsDomain));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (!isEdit && takenNames.includes(form.name.trim().toLowerCase())) {
      setError('A credential with that name already exists.');
      return;
    }
    if (!isEdit && !secret.trim()) {
      setError('Paste the API key to finish adding this credential.');
      return;
    }
    setSaving(true);
    const result = proposal
      ? await api.approveProposal(proposal.id, toInput(form), secret)
      : await api.saveCredential(toInput(form), secret || undefined);
    setSaving(false);
    // Clear the key from component state as soon as it's handed to the vault.
    setSecret('');
    if (result.ok) onSaved();
    else setError(result.error);
  }

  const title = proposal ? 'Review proposed credential' : isEdit ? existing!.name : 'Add credential';
  const description = proposal
    ? 'An agent filled this in from the API docs. Check it, then add your key.'
    : isEdit
      ? 'Where this key may be sent and how it’s attached.'
      : undefined;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* For proposals, open at the top: the "is this a known provider" callout must be read first. */}
      <DialogContent className="max-w-xl" onOpenAutoFocus={proposal ? (e) => e.preventDefault() : undefined}>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader title={title} description={description} />
          <DialogBody className="flex flex-col gap-4">
            {proposal && (
              <Callout tone={proposal.matchesPreset ? 'good' : 'warn'} icon={proposal.matchesPreset ? <ShieldCheck /> : <AlertTriangle />}>
                {proposal.matchesPreset
                  ? `Matches Keybroker's built-in ${proposal.matchesPreset} settings.`
                  : "Doesn't match a built-in provider. Check the hosts carefully: your key will be sent to them."}
                {!docsHost && ' No docs link was given, so compare against the provider’s documentation yourself.'}
              </Callout>
            )}

            {!isEdit && !proposal && (
              <Field label="Start from a known provider">
                <Select
                  defaultValue=""
                  onChange={(e) => {
                    const preset = presets.find((p) => p.name === e.target.value);
                    if (preset) setForm(toForm(preset));
                  }}
                >
                  <option value="">Custom…</option>
                  {presets.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Name">
                <Input value={form.name} disabled={isEdit} onChange={(e) => set('name', e.target.value)} placeholder="elevenlabs" required />
              </Field>
              <Field label="Env var for SDKs">
                <Input
                  className="font-mono text-sm"
                  value={form.envVar}
                  onChange={(e) => set('envVar', e.target.value.toUpperCase())}
                  placeholder="ELEVENLABS_API_KEY"
                />
              </Field>
            </div>

            <Field
              label="Allowed hosts"
              hint={
                hostsOffDocsDomain ? (
                  <span className="text-warning">These hosts don't match the docs domain ({docsHost}). Double-check them.</span>
                ) : (
                  'Only sent to these hosts, over HTTPS. Comma-separated; *.example.com for subdomains.'
                )
              }
            >
              <Input className="font-mono text-sm" value={form.hosts} onChange={(e) => set('hosts', e.target.value)} placeholder="api.elevenlabs.io" required />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Auth scheme">
                <Select value={form.authType} onChange={(e) => set('authType', e.target.value as AuthType)}>
                  <option value="bearer">Authorization: Bearer</option>
                  <option value="header">Custom header</option>
                  <option value="query">Query parameter</option>
                  <option value="basic">Basic auth</option>
                </Select>
              </Field>
              {form.authType === 'header' && (
                <Field label="Header name">
                  <Input className="font-mono text-sm" value={form.header} onChange={(e) => set('header', e.target.value)} placeholder="xi-api-key" required />
                </Field>
              )}
              {form.authType === 'query' && (
                <Field label="Parameter name">
                  <Input className="font-mono text-sm" value={form.param} onChange={(e) => set('param', e.target.value)} placeholder="api_key" required />
                </Field>
              )}
              {form.authType === 'basic' && (
                <Field label="Username (optional)">
                  <Input value={form.username} onChange={(e) => set('username', e.target.value)} placeholder="blank if key is user:pass" />
                </Field>
              )}
            </div>
            {form.authType === 'header' && (
              <Field label="Value prefix (optional)">
                <Input value={form.prefix} onChange={(e) => set('prefix', e.target.value)} placeholder='e.g. "Token "' />
              </Field>
            )}

            <Field label="Docs URL">
              <Input value={form.docsUrl} onChange={(e) => set('docsUrl', e.target.value)} placeholder="https://…" />
            </Field>

            {form.notes && (
              <Callout tone="info" icon={<Sparkles className="text-primary" />}>
                {proposal && <span className="font-medium">Note from the agent (unverified): </span>}
                {form.notes}
              </Callout>
            )}
            {proposal?.testRequest && (
              <p className="text-sm text-muted-foreground">
                After saving, Keybroker checks the key with{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  {proposal.testRequest.method ?? 'GET'} {proposal.testRequest.path}
                </code>
                . The agent only learns the status code.
              </p>
            )}

            <div className="rounded-lg border border-primary/20 bg-primary/6 p-3">
              <Field
                label={
                  <span className="flex items-center gap-1.5">
                    <KeyRound className="size-3.5 text-primary" />
                    {isEdit ? 'Replace API key' : 'API key'}
                  </span>
                }
                hint="Encrypted with a key in your macOS Keychain. Never shown to agents, or back to you."
              >
                <Input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={isEdit && existing?.hasSecret ? '•••••••• stored (leave blank to keep)' : 'Paste your key'}
                  autoFocus={isEdit}
                />
              </Field>
            </div>

            {error && (
              <Callout tone="warn" icon={<AlertTriangle />}>
                {error}
              </Callout>
            )}
          </DialogBody>
          <DialogFooter>
            {form.docsUrl.startsWith('https://') && (
              <Button type="button" variant="ghost" className="mr-auto" onClick={() => api.openExternal(form.docsUrl)}>
                <ExternalLink />
                Docs
              </Button>
            )}
            {proposal ? (
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  await api.rejectProposal(proposal.id);
                  onClose();
                }}
              >
                Reject
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : proposal ? 'Save & test' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
