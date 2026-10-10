import type { ArgSource, ToolDef } from './api/types'

export interface SampleAction {
  node_id: string
  /** Candidate tool names / keywords, resolved against GET /v1/tools. */
  toolHints: string[]
  args: Record<string, unknown>
  arg_sources: Record<string, ArgSource>
}

export interface Sample {
  id: string
  label: string
  description: string
  goal: string
  actions: SampleAction[]
  done_criteria: string[]
  auto_approve_low_risk?: boolean
}

const EMAIL = ['email.send', 'send_email', 'gmail.send', 'email', 'mail']
const SLACK = ['slack.post_message', 'slack.post', 'post_slack_message', 'slack']
const CRM = ['crm.update_record', 'crm.update', 'update_crm_record', 'crm']

export const SAMPLES: Sample[] = [
  {
    id: 'vendor-followup',
    label: 'Vendor follow-up (email + Slack + CRM)',
    description: 'Three write actions across three systems; the email needs approval.',
    goal:
      'Follow up with Northwind Supplies about the delayed PO-4417 shipment: email their account manager, post a status update to #procurement, and move the CRM opportunity to "Follow-up sent".',
    actions: [
      {
        node_id: 'email_vendor',
        toolHints: EMAIL,
        args: {
          to: 'dana.reyes@northwind-supplies.example',
          subject: 'PO-4417: updated delivery date?',
          body:
            'Hi Dana,\n\nFollowing up on PO-4417, which was due on the 3rd. Could you share an updated delivery date and tracking number?\n\nThanks,\nOps team',
        },
        arg_sources: { to: 'user', subject: 'user', body: 'user' },
      },
      {
        node_id: 'notify_slack',
        toolHints: SLACK,
        args: {
          channel: '#procurement',
          text: 'Followed up with Northwind on the PO-4417 delay. Waiting on a new ETA.',
        },
        arg_sources: { channel: 'user', text: 'user' },
      },
      {
        node_id: 'update_crm',
        toolHints: CRM,
        args: {
          record_id: 'acct-1001',
          fields: { stage: 'Follow-up sent', next_step: 'Await revised ETA from Dana' },
        },
        arg_sources: { record_id: 'user', fields: 'user' },
      },
    ],
    done_criteria: [
      'Email to dana.reyes@northwind-supplies.example is recorded as sent',
      'Status update is posted in #procurement',
      'CRM record acct-1001 has stage "Follow-up sent"',
    ],
  },
  {
    id: 'taint-recipient',
    label: 'Inbound email with injected recipient (should be blocked)',
    description: 'Recipient comes from an untrusted inbound email; taint policy blocks it.',
    goal:
      'An inbound email from "Northwind Billing" says the bank details changed and asks us to confirm payment to a new address. Send the payment confirmation and let #finance know.',
    actions: [
      {
        node_id: 'confirm_payment',
        toolHints: EMAIL,
        args: {
          to: 'payments@northwind-billing-update.example',
          subject: 'Payment confirmation: INV-2291',
          body: 'Confirming payment of INV-2291 to the updated account ending 7781.',
        },
        arg_sources: { to: 'untrusted', subject: 'user', body: 'untrusted' },
      },
      {
        node_id: 'tell_finance',
        toolHints: SLACK,
        args: {
          channel: '#finance',
          text: 'Inbound email claims Northwind changed bank details (INV-2291). Please verify by phone before paying.',
        },
        arg_sources: { channel: 'user', text: 'untrusted' },
      },
    ],
    done_criteria: ['#finance has been notified about the INV-2291 bank-detail change request'],
  },
  {
    id: 'internal-update',
    label: 'Low-risk internal update (auto-approve)',
    description: 'A single internal Slack post; low risk, approved automatically.',
    goal: 'Post the weekly incubator standup reminder to #aiml-incubator.',
    actions: [
      {
        node_id: 'standup_reminder',
        toolHints: SLACK,
        args: {
          channel: '#aiml-incubator',
          text: 'Reminder: weekly standup is Thursday 10:00. Add your updates to the doc beforehand.',
        },
        arg_sources: { channel: 'user', text: 'user' },
      },
    ],
    done_criteria: ['Reminder is posted in #aiml-incubator'],
    auto_approve_low_risk: true,
  },
]

export function resolveTool(hints: string[], tools: ToolDef[]): string {
  if (!tools.length) return hints[0]
  const names = tools.map((t) => t.name)
  for (const h of hints) if (names.includes(h)) return h
  const writes = tools.filter((t) => (t.kind ?? 'write') === 'write')
  for (const pool of [writes, tools]) {
    for (const h of hints) {
      const hit = pool.find((t) => t.name.toLowerCase().includes(h.toLowerCase()))
      if (hit) return hit.name
    }
  }
  return hints[0]
}
