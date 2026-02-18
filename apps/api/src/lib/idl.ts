// Quest Program IDL
// Generated from: anchor build -> target/idl/quest.json
// This is a placeholder — replace with the actual IDL after anchor build

export const IDL = {
  version: '0.1.0',
  name: 'quest',
  instructions: [
    { name: 'initialize', accounts: [], args: [] },
    { name: 'createQuest', accounts: [], args: [] },
    { name: 'claimQuest', accounts: [], args: [] },
    { name: 'submitProof', accounts: [], args: [] },
    { name: 'approveCompletion', accounts: [], args: [] },
    { name: 'rejectCompletion', accounts: [], args: [] },
    { name: 'cancelQuest', accounts: [], args: [] },
    { name: 'abandonClaim', accounts: [], args: [] },
    { name: 'expireClaim', accounts: [], args: [] },
    { name: 'autoApprove', accounts: [], args: [] },
  ],
} as const
