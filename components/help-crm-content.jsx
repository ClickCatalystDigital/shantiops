// Plain data for the CRM Help sidebar (app/help/page.js -> components/CrmHelpWorkspace.jsx).
// Same "plain data, no CMS" convention as components/help-content.jsx, just richer per-feature
// pages (short paragraphs, not one-line steps) since these are meant to be read on their own,
// not skimmed in a grid. `depts` on each feature controls who sees it in the sidebar — Sales-only
// features (Customers/Quotations/Sale Orders) don't show for a Marketing-only viewer and vice
// versa; features both departments use aren't tagged (shown to both).
import {
  UserPlusIcon, TrendingUpIcon, MegaphoneIcon, UsersIcon, FileTextIcon, ShoppingCartIcon,
  CheckSquareIcon, PhoneIcon, BookmarkIcon, ContactIcon, BarChart3Icon, MessageCircleIcon,
} from 'lucide-react';

export const CRM_INTRO = {
  title: 'Introduction to Sales',
  body: [
    `This is Shanti Ops' own CRM — built to match the record-keeping depth of ERPNext CRM and the
     day-to-day tools (tasks, call logs, saved views, auto-assignment) of Frappe CRM, the product
     ERPNext itself now points people to.`,
    `Sales and Marketing share one funnel, not two. A Lead can come from either department, moves
     through the same Opportunity pipeline, and only the paperwork after a deal is won — Customers,
     Quotations, Sale Orders — belongs to Sales alone. Marketing owns Campaigns and shares
     everything upstream of the sale.`,
    `What's here today: Leads, Opportunities/Pipeline, Campaigns, Customers, Quotations, Sale
     Orders, Tasks, Notes & Call Log, saved Lead views, round-robin lead assignment, Reports (with
     charts and PDF export), and quick WhatsApp/Email links on any phone/email on file.`,
    `What's not here yet, on purpose: real email/WhatsApp sending (only quick links today), a
     dashboard with trend charts, and a few deeper analytics reports (forecasting, win/loss
     breakdown, churn). These are recorded as planned work, not forgotten.`,
  ],
};

export const CRM_FEATURES = [
  {
    key: 'leads', label: 'Leads', icon: UserPlusIcon,
    body: [
      `A Lead is a person or company that's shown interest but isn't a customer yet. Capture their
       name, company, phone, email, where they came from (Source), and — if you know it —
       Territory and Industry.`,
      `Every lead has a Status: new, contacted, qualified, converted, or lost. Move it forward as
       you work it. A lead sitting in "new" for more than 24 hours is flagged with a red "SLA
       overdue" badge — that's your reminder nobody's followed up yet.`,
      `Click a lead to open its detail view: log calls and notes there, add tasks with due dates,
       and see who it's assigned to. When a lead is ready, hit Convert — it creates a Customer and
       an Opportunity for you in one step, so you never retype the same information.`,
      `Leads are shared between Sales and Marketing — whoever created it owns it, but both
       departments can see and work every lead.`,
    ],
  },
  {
    key: 'opportunities', label: 'Opportunities / Pipeline', icon: TrendingUpIcon,
    body: [
      `An Opportunity is a deal you're actively chasing — it has a value, a stage, and (usually) a
       customer attached. Find the Pipeline as its own tab: a Kanban board you drag cards across as
       a deal moves from Lead through Qualified, Quoted, Won, or Lost.`,
      `Open a card to add line items, log a source, set a next-contact date, and — if it's marked
       Lost — record why. Consistent loss reasons are what make a "why do we lose deals" report
       possible later.`,
      `Tasks live here too: add a follow-up with a due date and an assignee right from the deal.`,
    ],
  },
  {
    key: 'campaigns', label: 'Campaigns', icon: MegaphoneIcon,
    body: [
      `A Campaign groups marketing activity — a trade show, an email push, a paid-ads push —
       so you can trace which leads and deals it actually produced.`,
      `Tag a lead or opportunity with a campaign when you create it, and the Reports tab's Campaign
       Performance report will total up leads generated and opportunity value attributed to each
       one.`,
    ],
  },
  {
    key: 'customers', label: 'Customers', icon: UsersIcon, depts: ['Sales'],
    body: [
      `A Customer is the commercial party you actually sell to and bill — created automatically
       when you convert a Lead, or manually if you already know who you're dealing with.`,
      `Add Contacts (people at that company) and Addresses (billing/shipping locations) underneath
       the customer record so Quotations and Sale Orders can reuse them instead of retyping every
       time.`,
      `This is Sales-only — Marketing works the Lead/Opportunity/Campaign side and hands off once a
       deal needs a formal customer account.`,
    ],
  },
  {
    key: 'quotations', label: 'Quotations', icon: FileTextIcon, depts: ['Sales'],
    body: [
      `A Quotation is the commercial proposal — line items, quantities, rates — you send a
       customer. Generate a PDF straight from the record.`,
      `Once accepted, convert it directly into a Sale Order — no re-entering the line items.`,
    ],
  },
  {
    key: 'sale_orders', label: 'Sale Orders', icon: ShoppingCartIcon, depts: ['Sales'],
    body: [
      `A Sale Order is the confirmed, accepted order. It's what everything downstream — fulfilment,
       Design/Engineering's Scope of Supply work order, procurement, dispatch — keys off.`,
      `Linking a Sale Order to a Project is what starts the actual build: Design and Engineering see
       a Scope of Supply draft appear on their side the moment that link is made.`,
    ],
  },
  {
    key: 'tasks', label: 'Tasks', icon: CheckSquareIcon,
    body: [
      `A Task is a simple to-do with a title, a due date, and (optionally) who it's assigned to —
       attached to a Lead, an Opportunity, or a Customer.`,
      `Add one from inside any lead or deal, or see everything across the whole CRM in the Tasks
       tab. Tick it off when it's done; nothing is deleted, just marked complete.`,
    ],
  },
  {
    key: 'notes_calls', label: 'Notes & Call Log', icon: PhoneIcon,
    body: [
      `Every lead, opportunity, and customer has a shared activity timeline. Add a plain note, or
       check "Log as a call" to record the direction (incoming/outgoing) and how long it took.`,
      `Write down the outcome and next step, not just "spoke to customer" — that's what makes the
       note useful to whoever picks this up next.`,
    ],
  },
  {
    key: 'saved_views', label: 'Saved Views', icon: BookmarkIcon,
    body: [
      `On the Leads list, filter by status, source, or a search term, then "Save current filters
       as…" to pin it as a one-click chip. It's personal to you — nobody else sees your saved
       views, and you don't see theirs.`,
    ],
  },
  {
    key: 'team', label: 'Team / Assignment Rules', icon: ContactIcon,
    body: [
      `The Team tab is where a department head sets up round-robin lead assignment: list the
       usernames who should receive new leads for your department, and every new lead
       auto-assigns to the next person in that list.`,
      `You only manage your own department's list — Sales can't touch Marketing's rota and vice
       versa. Leave it blank to turn auto-assignment off.`,
    ],
  },
  {
    key: 'reports', label: 'Reports', icon: BarChart3Icon,
    body: [
      `Reports is its own top-level tab, with a sidebar split into Sales and Marketing sections —
       you only see the reports for departments you belong to.`,
      `Sales gets Sales Pipeline (value and win rate by stage) and By Department (the shared
       funnel, sliced by who's driving it). Marketing gets Lead Funnel, Leads by Source, and
       Campaign Performance.`,
      `Every report has a Download PDF button — it uses your browser's own print-to-PDF, so
       there's no extra software involved.`,
    ],
  },
  {
    key: 'whatsapp_email', label: 'WhatsApp / Email links', icon: MessageCircleIcon,
    body: [
      `Wherever a phone or email is on file — a lead, a customer, a contact — you'll see small
       WhatsApp and Email links. WhatsApp opens WhatsApp Web with that number ready to message;
       Email opens your own mail app addressed to them.`,
      `These are just links, not a connected inbox — messages you send aren't logged back into the
       CRM automatically. Log the outcome yourself as a note afterward.`,
    ],
  },
];

export const CRM_HOWTO = [
  { title: 'Capture the lead', body: 'A new enquiry comes in — from a call, a website form, a referral, a trade show. Add it as a Lead with a name, contact details, and Source.' },
  { title: 'Work it', body: 'Call, email, or meet — log each contact as a note (or a call, with duration). Move the status to "contacted", then "qualified" once you\'ve confirmed there\'s a real requirement.' },
  { title: 'Convert', body: 'Once qualified, hit Convert on the lead. This creates a Customer and an Opportunity in one step — you never retype what you already captured.' },
  { title: 'Work the deal', body: 'On the Opportunity, add line items, set an expected value and next-contact date, and drag it across the Pipeline board as it moves through Qualified → Quoted → Won or Lost.' },
  { title: 'Quote it', body: 'When you\'re ready to make an offer, create a Quotation with real line items and send the PDF.' },
  { title: 'Confirm the order', body: 'Once accepted, convert the Quotation into a Sale Order — the confirmed, accepted order.' },
  { title: 'Hand off to build', body: 'Link the Sale Order to a Project. Design and Engineering automatically get a Scope of Supply draft to start working from.' },
  { title: 'Keep the pipeline honest', body: 'Review Reports regularly. Mark stale opportunities Lost with a real reason instead of leaving them sitting — an accurate smaller pipeline beats a big one full of dead deals.' },
];
