# Grupo Cacao: business model

This document explains how Grupo Cacao makes money, product by product, and how the products feed each other. Every price below is the one the product uses today, or a proposal that is marked as one. Figures from outside sources name their source. Anything we have not measured is marked as an **assumption**.

## 1. In one paragraph

Grupo Cacao earns from the flow of money through it. The public products (Media, Travel, Market) bring people and their payments: a few cents per story, a commission on each booking and on each order. Every one of those payments runs through CacaoPay, which also earns on remittances and, later, on processing for outside businesses. CacaoLedger turns each paid sale into its tax invoice and charges businesses a monthly subscription for it. The public side brings volume; the business side brings recurring revenue and keeps the businesses in.

## 2. Who pays and why

| Customer | What they buy | Why they pay us and not someone else |
|---|---|---|
| Reader | One story at a time | No subscription and no account; pays cents, only for what they read |
| Traveller | A local experience | Finds it through the story about that place; pays in bitcoin in seconds |
| Buyer | Local products and services | One cart across many small shops, paid over Lightning |
| Family abroad | A remittance home | Sees the fee, the rate and the amount that arrives before paying; Lightning delivery is cheapest |
| Tour operator, shop, producer | A sales channel | Reaches customers who already want to pay in bitcoin, without building any technology |
| Any business that takes bitcoin | Payments, invoices and taxes | Gets paid, and each sale becomes a DTE sealed with Hacienda automatically |
| Accounting firm | Its clients' books | Monthly VAT books and F-07/F-14 figures for many merchants in one place |

## 3. Revenue by product

### Cacao Media: pay per story

- **Price:** 120 sats per paid story. At an illustrative price of $100,000 per bitcoin, that is $0.12. The paywall always shows the dollar value at the current price.
- **Free stories:** stories linked to a Travel experience have no paywall. They are marketing for the booking, and the author is paid from the booking instead (see Travel).
- **Why the price works:** a card payment can't carry a $0.12 charge, because the fee would be larger than the price. Over Lightning it costs a fraction of a cent. Media is a business model that only exists because of Lightning.
- **Open decision:** the product does not yet split the 120 sats of an unlinked story between Media and its author. That share has to be agreed with writers.
- Detailed case (user, preview limits, KPIs, funnel): [negocio-media.md](negocio-media.md).

### Cacao Travel: commission on each booking

The split is computed on the server for every booking (`travel/src/lib/reparto.ts`):

| Booking | Operator | Cacao Travel | Story author |
|---|---|---|---|
| Experience with a linked Media story | 85% | 10% | 5% |
| Experience without a linked story | 90% | 10% | — |

**Example:** a $40 surf class in El Tunco, booked from the Media story about it: the operator gets $34.00, Cacao Travel $4.00 and the author $2.00. The writer whose story sold the class is paid for it, which is what makes the free linked stories sustainable.

### CacaoMarket: commission on each order

- Each order stores a **theoretical 1% commission** (`comision_teorica_sats`, rounded up), and the admin panel adds it up.
- **Today no flow charges it.** It is kept so the take rate can be switched on with real numbers behind it.
- **Example:** an $11.00 bag of ground coffee would leave $0.11 to Market.
- **Assumption:** 1% is low enough for small sellers to accept, and well under what card processors charge. It still has to be tested with sellers.

### CacaoPay: remittances now, processing later

**Remittance fees** (in `pay/src/lib/cotizacion.ts`, recomputed on the server and in the database):

| Delivery | Fixed fee | Percentage | $100 sent → fee | Arrives |
|---|---|---|---|---|
| Bitcoin over Lightning | $0.00 | 0.50% | $0.50 | $99.50 in sats |
| Bank account | $0.99 | 1.00% | $1.99 | $98.01 |
| Cash | $1.99 | 1.50% | $3.49 | $96.51 |

The fee is always shown on its own line, never hidden in the exchange rate. **Assumption:** these are the simulator's fees. They have not been compared with a real provider's (see `pay/docs/modelo-comisiones-y-conversion.md` and `pay/docs/competidores.md`).

**Market size, from the BCR:** El Salvador received **US$8,181.8 million** in remittances in 2023, of which **US$82.9 million** came in bitcoin (BCR note of January 2024, cited in `pay/docs/investigacion-mercado.md`). Even a small share of a market that size matters, and Lightning delivery is the cheapest line for the family.

**Processing for businesses:** CacaoPay already charges for Media, Travel and Market, and for any shop that activates its counter QR or uses the API. **Today it takes no fee on those charges.** A processing fee is the natural next revenue line. It has to stay well below card rates, because being cheaper than a card is the reason a business switches.

**Why remittances and Pay belong together:** a family that receives sats can spend them at the shops that charge with CacaoPay. The money that comes in stays in the local economy, and every hop goes through Pay.

### CacaoLedger: monthly subscription (SaaS)

Proposed plans (from `ledger/docs/estrategia-y-hacienda.md`):

| Plan | Price | For |
|---|---|---|
| Comercio Semilla | $9.00 / month + VAT | Up to 300 DTE a month, daily close, rate attestation, VAT books and F-07/F-14 annexes |
| Comercio Cosecha | $24.00 / month + VAT | Up to 2,500 DTE a month, several points of sale, automatic import from CacaoMarket, export for the accountant |
| Despacho Contable | $65.00 / month + VAT | A console for accountants serving up to 15 merchants |

- **Cost to serve:** under $1.50 per merchant per month (light compute, 10 years of DTE storage, deadline monitoring). **Assumption**, from the same document.
- **Break-even:** 120 merchants on Semilla/Cosecha plus 15 accounting firms bring more than $2,500 a month in recurring revenue, with a gross margin above 85%.
- **The argument for the merchant:** a full year of Semilla ($108) costs about 34 times less than the minimum fine for invoicing failures under Art. 239-A of the Tax Code ($3,679.20, nine monthly minimum wages). The legal figures are marked "to confirm" in the source document.

## 4. The flywheel

```
   Media brings readers ──► readers book in Travel and buy in Market
          ▲                                  │
          │                                  ▼
   authors earn from bookings      every payment goes through CacaoPay
   and write more stories                    │
          ▲                                  ▼
          │                     each paid sale becomes a DTE in CacaoLedger
          │                                  │
          └──── businesses with their taxes solved charge with Pay ◄──┘
```

- **Content is the cheapest acquisition channel:** a story about a place brings the person who will book it.
- **The authors are paid from what their stories sell,** so they have a reason to write the next one.
- **Ledger is the retention:** once a business's invoices, daily close and VAT books live in Cacao, switching away is costly, and Ledger works best when the payments come through Pay.
- **Remittances add money to the loop from outside the country,** and that money can be spent at the same businesses.

## 5. Costs

- **Hosting:** five sites on Vercel and one shared Supabase project. The demo runs on free plans.
- **Payments:** a self-hosted BTCPay Server with a Lightning node. No per-transaction fee to a payment provider, and no third party holds the funds. In production that means one server and its operation, plus channel liquidity.
- **Sign-in:** Clerk, free at the demo's scale.
- **Invoicing:** the Ministry's signing tool and reception service have no fee; each merchant needs its own certificate and credentials.
- **The real costs are people:** editorial work for Media, onboarding operators and sellers, and support for merchants on Ledger.

## 6. Risks

| Risk | What could happen | How we handle it |
|---|---|---|
| Bitcoin price | The dollar value of 120 sats moves | The paywall shows the dollar value at the moment; prices can be revised in sats |
| Regulation of custody | Holding customers' bitcoin on a shared node can make Cacao a regulated provider (CNAD, BCR) | The demo has no payouts; with real money, each business gets paid to its own wallet, or we go through legal review first |
| Hacienda's rules | Real reception could reject what the official schema accepts (for example payment code 11 on invoice 01) | Ledger validates against the official 2026 schemas and documents each gap in `ledger/docs/hallazgos.md`; testing against the Ministry's test service is the next step |
| Low conversion | Readers don't pay, sellers don't join | The funnel is already measured (`eventos`); prices and take rates are switched on only with data |
| Sample content | The demo's stories and experiences are not real offerings | They are labelled as samples; real launch needs editorial checks and real operators |

## 7. What is real today and what has to be validated

**Real and working:** the five live products; Lightning invoices on BTCPay (regtest, no value); the payments API that Media, Travel and Market use; the Travel split; the remittance quote and its fees; DTE 01 and 03 validated against the official schemas, signed with a test key and sealed by a community test simulator; the daily close and the VAT books.

**To validate before charging real money:**

1. Interviews with readers, operators, sellers and merchants about the prices above.
2. One month of real funnel data before switching on Market's 1% and a Pay processing fee.
3. The author's share of unlinked Media stories, agreed with writers.
4. Ledger's figures and deadlines reviewed with an accountant, and transmission tested against the Ministry's test service with a registered NIT.
5. Legal review of custody and of moving from regtest to mainnet.

## 8. Recommendation

Start where Lightning gives an advantage nobody else can match: **Media's per-story payments and Travel's split**, which bring people in, and **Ledger for merchants**, which brings recurring revenue and solves the problem that keeps businesses from taking bitcoin officially. Turn on Market's commission and a Pay processing fee only once the funnel data supports them. Keep remittances as the plus that brings outside money into the same loop.
