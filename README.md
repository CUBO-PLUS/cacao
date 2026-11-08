# Grupo Cacao

**One place to read, travel, buy and get paid in bitcoin.**

Grupo Cacao is a set of five connected products built in El Salvador for the CUBO+ Build Sprint 2026. Three are for the public: **Cacao Media**, **Cacao Travel** and **CacaoMarket**. Two are for businesses: **CacaoPay**, the payment engine every sale goes through, and **CacaoLedger**, which turns each sale into the electronic invoice the tax authority requires.

The idea fits in one sentence: *a payment shouldn't stop at the payment.* When someone pays in bitcoin, the money should reach the business, the sale should be recorded, the invoice should reach Hacienda, and the business owner should see it all at the end of the day, without copying anything by hand.

| Product | For | What it does | Live |
|---|---|---|---|
| **Grupo Cacao** | Everyone | The front door: the five products and how they fit together | https://cacao-grupo.vercel.app |
| **Cacao Media** | The public | Stories about El Salvador. Each paid story unlocks for 120 sats | https://cacao-media.vercel.app |
| **Cacao Travel** | The public | Local experiences (surf, volcanoes, lagoons) priced in sats | https://cacao-travel.vercel.app |
| **CacaoMarket** | The public | Salvadoran products and services, paid over Lightning | https://cacao-market.vercel.app |
| **CacaoPay** | Businesses | The payment engine: payments API, counter QR, remittances | https://cacao-pay.vercel.app |
| **CacaoLedger** | Businesses | Electronic invoices (DTE) for Hacienda, daily close, VAT books | https://cacao-cuentas.vercel.app |

> **Status: working demo.** Every product is live and charges real Lightning invoices, but on bitcoin **regtest** (test bitcoin with no value). No real money moves. Invoices are sent to a **community test simulator** of Hacienda's system, not to the Ministry. See [What is real and what is not](#what-is-real-and-what-is-not).

---

## The problem

El Salvador made bitcoin legal tender in 2021, and thousands of businesses can take a Lightning payment. In January 2025 a reform tied to the IMF agreement made accepting bitcoin voluntary for private businesses, so tools that make accepting it easy and compliant matter more, not less. Getting paid in bitcoin was the easy part. What comes after it is not:

1. **The tools are scattered.** A reader, a traveller and a shopper use three unrelated apps, and none of them knows about the others. Money that comes in through one never meets the places where it could be spent.
2. **Small payments don't work on cards.** A $0.12 story or a single pupusa can't carry a card fee. Most online content falls back on ads or monthly subscriptions.
3. **The tax side breaks the deal.** Electronic invoicing (DTE) is mandatory in El Salvador. A business that takes bitcoin still has to issue a DTE for each sale, record the exchange rate, and file its VAT books. If that means copying every Lightning payment into another system by hand, the business stops accepting bitcoin, or accepts it off the books.
4. **Remittances are expensive.** Remittances are roughly a quarter of the country's GDP, and the traditional services keep a real slice of every transfer.

## The answer: two faces, one engine

Grupo Cacao has a **public face** and a **business face**, and one payment engine in the middle.

```
            THE PUBLIC                                     THE BUSINESS
   ┌──────────────┬──────────────┬──────────────┐
   │ Cacao Media  │ Cacao Travel │ CacaoMarket  │       a shop with a counter QR,
   │  read for    │  book an     │  buy local   │       or any system using the API
   │  120 sats    │  experience  │  products    │                 │
   └──────┬───────┴──────┬───────┴──────┬───────┘                 │
          │              │              │                         │
          └──────────────┴──────┬───────┴─────────────────────────┘
                                ▼
                    ┌────────────────────────┐
                    │        CacaoPay        │  one payments API (v1): every charge,
                    │    the payment engine  │  its Lightning invoice, its state,
                    └───────────┬────────────┘  signed notices back to the product
                                │
              ┌─────────────────┼──────────────────┐
              ▼                                    ▼
   ┌────────────────────┐             ┌──────────────────────────┐
   │   BTCPay Server    │             │       CacaoLedger        │
   │ Lightning invoice, │             │ sale → DTE 01 or 03,     │
   │ self-hosted        │             │ signed, sent to Hacienda,│
   └────────────────────┘             │ daily close, VAT books   │
                                      └──────────────────────────┘
```

**For the user, everything is in one place.** You read about El Tunco in Media, book the surf class in Travel from the same story, buy coffee from a local roaster in Market, and pay for all of it with bitcoin, in cents and in seconds. Stories linked to an experience are free, because the experience pays for them.

**For the business owner, accepting bitcoin stops being extra work.** CacaoPay collects the money and CacaoLedger turns each paid sale into its invoice, seals it with Hacienda and adds it to the day's close. The owner gets paid, stays compliant, and sees the day's numbers on one screen.

## The products

### Cacao Media — read for cents

A publication of stories about El Salvador: surf breaks, volcanoes, sea turtles, coffee, food and culture. Each paid story shows its free opening, then a paywall asking for **120 sats** (about twelve cents), with the value in dollars at the current bitcoin price. The reader pays a Lightning invoice and the story opens in place.

- **No account, no subscription.** The reader is recognised by an anonymous browser cookie. A paid story reopens by itself in that browser, and an access code lets the reader open it on another phone.
- **Stories linked to Travel are free.** Their revenue comes from the booking, not from the paywall.
- **Why it matters:** micropayments are something only Lightning makes practical. Writers get paid per story instead of depending on ads, and readers pay cents instead of a monthly fee.

Code: repository root (`src/`). Technical guide: [docs/media-y-travel.md](docs/media-y-travel.md). Business case: [docs/negocio-media.md](docs/negocio-media.md).

### Cacao Travel — book the place you just read about

A catalogue of local experiences: surf lessons, kayaking, volcano hikes, lagoons and beaches. Each one is linked to the Media stories about that place, and each booking is paid over Lightning.

- **Every booking splits automatically:** 85% to the operator, 10% to Cacao Travel and 5% to the author of the linked story. Without a linked story, 90% to the operator and 10% to Travel.
- **Why it matters:** tourism is one of the main ways bitcoin enters El Salvador's economy (El Zonte, "Bitcoin Beach", and Surf City). Travel lets small operators reach visitors who already want to pay in bitcoin, and it pays the writer whose story brought the visitor.

Code: `travel/`. Technical guide: [docs/media-y-travel.md](docs/media-y-travel.md).

### CacaoMarket — buy local, pay in sats

An online market for Salvadoran products and services: coffee, pupusas, horchata, yuca, and services at a fixed price or by quote. The cart splits by shop and each shop gets its own order. Buyers track their order from paid to delivered. Sellers publish products, answer quotes and manage inventory and orders from their panel. There is also a board where a buyer posts a need and businesses send offers.

- **Why it matters:** a small producer gets an online store and bitcoin payments without building any technology.

Code and docs: [`market/`](market/README.md).

### CacaoPay — the payment engine (business)

CacaoPay is the payment layer of the whole group.

- **Payments API (v1).** Any system creates a charge with one call (`POST /api/v1/cobros/`). CacaoPay makes the Lightning invoice in BTCPay, follows its state, and sends a signed notice back when it is paid. Each client has its own key, rate limit and idempotency, so a retried request never charges twice. **Media, Travel and Market charge through this API in production.**
- **CacaoPay for businesses.** A shop activates its account, prints its counter QR, and charges at the counter. Each charge is reported to CacaoLedger automatically, so it gets its invoice without anyone typing it.
- **Where to spend.** A map of real places in El Salvador that accept bitcoin, with the ones that charge through CacaoPay marked.
- **Remittances (the plus).** Send money home to El Salvador. The fee, the exchange rate and its source, and the exact amount that arrives are shown separately before confirming. Delivery is in cash, to a bank account, or in bitcoin over Lightning. Every transfer has a tracking code that works without an account.
- **Why it matters:** one simple way for any business to accept bitcoin, and a cheaper way for families to send money. A remittance received in sats can be spent at the businesses that charge with Pay.

Code and docs: [`pay/`](pay/README.md).

### CacaoLedger — invoices and taxes (business)

CacaoLedger takes a paid sale and produces the **DTE** (documento tributario electrónico) that the Ministerio de Hacienda requires: invoice **01** for a final consumer or tax credit receipt **03** for a registered taxpayer, with 13% VAT.

- **Records how each sale was paid,** including the bitcoin exchange rate at that moment, in a hash-chained **rate attestation** that can be verified and shows any tampering. A DTE has no field for that rate, so Ledger keeps it next to the document.
- **Signs and transmits.** It signs each DTE as a JWS and transmits it to a test simulator of Hacienda's reception service, which returns a seal.
- **Daily close:** one question at the end of the day, "Does every payment today have its seal?", with every sale sorted into sealed, orphaned (paid without a valid document), within its 24-hour window, or open.
- **Monthly VAT books** for final consumers and taxpayers, the figures for forms F-07 and F-14, and CSV exports for the accountant.
- **API v1** so other systems (CacaoPay today) can register their sales.
- **Why it matters:** electronic invoicing is the main thing that keeps businesses from accepting bitcoin "officially". Ledger closes that gap.

Code and docs: [`ledger/`](ledger/README.md). It also ships as a command-line tool with a full offline demo (`npm run demo`).

## Business model

Each product earns in the way that fits it, and the products feed each other. The full model, with the numbers, the unit economics and the assumptions still to validate, is in **[docs/business-model.md](docs/business-model.md)**.

| Product | How it earns | Price in the product today |
|---|---|---|
| Cacao Media | Pay per story | 120 sats per paid story; stories linked to Travel are free |
| Cacao Travel | Commission on each booking | 10% of each booking (5% more goes to the story's author) |
| CacaoMarket | Commission on each order | 1% calculated and stored on every order, not charged yet |
| CacaoPay | Remittance fees; later, processing for businesses | Lightning 0.50%, bank account $0.99 + 1%, cash $1.99 + 1.5% |
| CacaoLedger | Monthly subscription (SaaS) | Proposed plans: $9, $24 and $65 a month + VAT |

The flywheel: **Media brings readers → readers become travellers and buyers → their payments go through Pay → every paid sale becomes an invoice in Ledger → businesses that see their taxes solved want to charge with Pay.**

## What is real and what is not

We prefer to say it plainly:

| Real and working | Simulated or pending |
|---|---|
| Five live sites, with sign-in (Clerk) and one shared database (Supabase) | **Payments use bitcoin regtest:** real Lightning invoices on a self-hosted BTCPay, but the bitcoin has no value |
| Every Media, Travel and Market payment goes through the CacaoPay API | Payouts to each business's own wallet are not in the demo; with real bitcoin, custody on a shared node needs legal review |
| A Lightning invoice per story, booking, order or counter charge, with its QR, countdown and confirmation | **Invoices go to a community test simulator** ([svfe-mock-api](https://github.com/antonio0x/svfe-mock-api)), not to Hacienda. Its seals have no tax validity |
| DTE 01 and 03 built and validated against the Ministry's official 2026 schemas | The signature uses a local test key, not a taxpayer certificate |
| Hash-chained rate attestation, daily close, VAT books and F-07/F-14 figures | Tax figures and deadlines are marked "to confirm" with an accountant |
| Remittance quotes, the state machine, tracking codes and the admin monitor | Remittance delivery in cash or to a bank account is simulated |
| Stories, experiences and products | Sample content: not editorially verified, no real operators |

A test wallet for paying the demo invoices is served from the BTCPay stack (`infra/btcpay/billetera/`). It can scan a payment QR with the camera or from a photo.

**Why BTCPay and not a custodial API.** All products charge through a self-hosted **BTCPay Server**: no third party holds the funds, there is no per-transaction fee to a provider, and the same stack runs on regtest for the demo and on mainnet in production. CacaoLedger also keeps an adapter and fixtures for the Blink webhook, because the invoicing challenge suggested Blink.

## Repository map

```
.                     Cacao Media (Astro), at the repository root
├── travel/           Cacao Travel (Astro)
├── market/           CacaoMarket (Next.js), plus the shared Supabase migrations in market/supabase/
├── pay/              CacaoPay (Next.js): payments API, business side, remittances
├── ledger/           CacaoLedger (Next.js web app + command-line tool)
├── cacao/            Grupo Cacao, the front door (static site)
├── infra/btcpay/     The self-hosted BTCPay stack (regtest) and the test wallet
├── docs/             Group documents: business model, Media business case, operations, design notes
└── tests/            Media and Travel browser tests (Playwright)
```

Each product is deployed separately on Vercel, has its own `package.json`, and documents its own setup, environment variables and tests in its folder.

**Stack:** TypeScript everywhere; Astro (Media, Travel), Next.js 16 (Market, Pay, Ledger); Supabase (Postgres, row-level security, database functions that hold the money rules); Clerk for sign-in; BTCPay Server with Lightning (regtest) for payments; Vitest and Playwright for tests.

**Shared rules across products:** money is integer cents and integer sats, never floats; prices are always recomputed on the server; every charge is created once per idempotency key; a payment counts only when the payment provider reports it paid; webhooks and notices are signed (HMAC-SHA256) and re-read from the source before anything changes.

## Running it

- **Media and Travel:** [docs/media-y-travel.md](docs/media-y-travel.md) (`npm install && npm run dev` at the root, and in `travel/`).
- **Market, Pay, Ledger:** the README in each folder. Market and Pay share a local Supabase stack started from `market/`.
- **Ledger without any account:** `cd ledger && npm install && npm run demo` runs the whole invoicing flow offline.
- **Picking the work up on another machine:** [docs/operacion.md](docs/operacion.md).

## Documents

| Document | What it covers |
|---|---|
| [docs/Grupo-Cacao-one-pager.pdf](docs/Grupo-Cacao-one-pager.pdf) and [docs/Grupo-Cacao-products.pdf](docs/Grupo-Cacao-products.pdf) | The group on one page, and each product with its link and why it matters |
| [docs/business-model.md](docs/business-model.md) | How each product earns, unit economics, the flywheel, risks and what to validate |
| [docs/negocio-media.md](docs/negocio-media.md) | Cacao Media's business case: user, pricing, preview limits, KPIs (Spanish) |
| [docs/media-y-travel.md](docs/media-y-travel.md) | Technical guide to Media and Travel: paywall, tokens, APIs, tests (Spanish) |
| [docs/Cacao-como-resolvemos-los-retos.pdf](docs/Cacao-como-resolvemos-los-retos.pdf) | How we answered each challenge of the sprint (Spanish) |
| [pay/docs/](pay/docs) | Payments API, architecture and Lightning, fees, Hacienda and BCR rules, remittance market research |
| [ledger/docs/](ledger/docs) | DTE findings, rate attestation, signing and merchants, test transmission, tax strategy and pricing |
| [market/docs/](market/docs) | Architecture, database, API and payments |

Terms and privacy for the group are in [cacao/legal.html](cacao/legal.html).
