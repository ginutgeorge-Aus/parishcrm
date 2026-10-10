const g = (label, slugs) => ({ label, items: slugs.map((s) => `docs/${s}`) })

export default [
  { label: 'Overview', items: ['docs', 'docs/history'] },
  g('Setup & Administration', [
    'installation', 'environment-variables', 'gmail-setup', 'upgrading',
    'settings-and-branding', 'regional-configuration', 'scheduled-jobs', 'operations-scripts',
  ]),
  g('People & Families', [
    'people-and-families', 'family-csv-import', 'birthdays-and-celebrations', 'sunday-school', 'family-self-update',
  ]),
  g('Dashboard & Accounting', [
    'dashboard', 'accounting-overview', 'transactions', 'budgets', 'financial-reports',
    'bank-statement-import', 'receipts', 'petty-cash', 'reconciliation',
  ]),
  g('Events', [
    'events-overview', 'registrations-management', 'public-event-registration', 'card-payments-stripe',
    'check-in', 'event-organisers', 'volunteer-crew-page', 'event-reminders', 'event-website-webhook',
  ]),
  g('Membership & Communication', [
    'membership-applications', 'membership-letters', 'email-notifications', 'feedback-widget',
    'help-and-whats-new',
  ]),
  g('Accounts & Security', [
    'roles-and-permissions', 'user-management', 'login-and-two-step-verification', 'security-model',
    'data-encryption', 'privacy-and-audit-log',
  ]),
]
