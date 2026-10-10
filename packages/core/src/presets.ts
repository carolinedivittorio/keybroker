import type { Credential } from './types.js';

export type Preset = Omit<Credential, 'createdAt' | 'updatedAt'> & { label: string };

/** Known providers, so the form can say "matches known preset" instead of trusting a suggestion blindly. */
export const PRESETS: Preset[] = [
  {
    label: 'ElevenLabs',
    name: 'elevenlabs',
    hosts: ['api.elevenlabs.io'],
    auth: { type: 'header', header: 'xi-api-key' },
    envVar: 'ELEVENLABS_API_KEY',
    docsUrl: 'https://elevenlabs.io/docs/api-reference/authentication',
    notes: 'Create a key at elevenlabs.io → Developers → API Keys.',
  },
  {
    label: 'OpenAI',
    name: 'openai',
    hosts: ['api.openai.com'],
    auth: { type: 'bearer' },
    envVar: 'OPENAI_API_KEY',
    docsUrl: 'https://platform.openai.com/docs/api-reference/authentication',
  },
  {
    label: 'Anthropic',
    name: 'anthropic',
    hosts: ['api.anthropic.com'],
    auth: { type: 'header', header: 'x-api-key' },
    envVar: 'ANTHROPIC_API_KEY',
    docsUrl: 'https://docs.anthropic.com/en/api/overview',
  },
  {
    label: 'Stripe',
    name: 'stripe',
    hosts: ['api.stripe.com'],
    auth: { type: 'bearer' },
    envVar: 'STRIPE_API_KEY',
    docsUrl: 'https://docs.stripe.com/api/authentication',
  },
  {
    label: 'Resend',
    name: 'resend',
    hosts: ['api.resend.com'],
    auth: { type: 'bearer' },
    envVar: 'RESEND_API_KEY',
    docsUrl: 'https://resend.com/docs/api-reference/introduction',
  },
  {
    label: 'GitHub',
    name: 'github',
    hosts: ['api.github.com'],
    auth: { type: 'bearer' },
    envVar: 'GITHUB_TOKEN',
    docsUrl: 'https://docs.github.com/en/rest/authentication',
  },
];
