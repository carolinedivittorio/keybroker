import { useState } from 'react';
import { Eye, KeyRound, MoreVertical, Plus, Trash2 } from 'lucide-react';
import type { CredentialView } from '../../../shared/api';
import { Badge, Dot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { timeAgo } from '@/lib/utils';

const api = window.keybroker;

interface Props {
  credentials: CredentialView[];
  lastUsed: Record<string, string>;
  onAdd(): void;
  onView(credential: CredentialView): void;
  onChanged(): void;
}

export function Credentials({ credentials, lastUsed, onAdd, onView, onChanged }: Props) {
  const [deleting, setDeleting] = useState<CredentialView>();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={onAdd}>
          <Plus />
          Add credential
        </Button>
      </div>

      <Card className="overflow-hidden">
        {credentials.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/12 text-primary">
              <KeyRound className="size-5" />
            </div>
            <div className="font-medium">No credentials yet</div>
            <p className="max-w-sm text-sm text-muted-foreground">
              Add one yourself, or ask your agent to set up an API. It'll fill in the details and you just paste the key.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Allowed hosts</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {credentials.map((c) => (
                <TableRow key={c.name} className="cursor-default" onDoubleClick={() => onView(c)}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {c.hosts.map((h) => (
                        <span key={h} className="rounded-md border bg-background/50 px-1.5 py-0.5 font-mono text-xs">
                          {h}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {c.hasSecret ? (
                      <Badge variant="success">
                        <Dot />
                        Stored
                      </Badge>
                    ) : (
                      <Badge variant="warning">
                        <Dot />
                        Missing
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{lastUsed[c.name] ? timeAgo(lastUsed[c.name]) : '—'}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.name}`}>
                          <MoreVertical />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => onView(c)}>
                          <Eye />
                          View details
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(c)}>
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(undefined)}>
        <DialogContent className="max-w-sm">
          <DialogHeader
            title={`Delete ${deleting?.name}?`}
            description="The stored key is erased from the vault. Agents lose access to this API until you add it again."
          />
          <DialogBody className="py-0" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(undefined)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                await api.deleteCredential(deleting!.name);
                setDeleting(undefined);
                onChanged();
              }}
            >
              <Trash2 />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
