// Client for scripts/affiliates/server.ts. Plain DOM, no build step; every value from the
// database is set through textContent, never innerHTML.
"use strict";

let state = null;
let selectedId = null;

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2200);
}

async function api(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `${response.status} ${response.statusText}`);
  return data;
}

function money(cents, currency) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(
    cents / 100,
  );
}

/** "$12.00" or "$12.00 · €3.00"; a dash when there is nothing. */
function moneyMap(map, { emptyAsZero = false } = {}) {
  const entries = Object.entries(map ?? {}).filter(([, cents]) => cents !== 0);
  if (entries.length === 0) return emptyAsZero ? money(0, "usd") : "—";
  return entries.map(([currency, cents]) => money(cents, currency)).join(" · ");
}

function date(value) {
  return value ? new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Link copied");
  } catch {
    toast(text);
  }
}

async function load() {
  try {
    state = await api("GET", "/api/state");
  } catch (error) {
    document.getElementById("overview").replaceChildren(
      h("tr", {}, h("td", { colspan: 11, class: "err" }, `Could not load: ${error.message}`)),
    );
    return;
  }
  const env = document.getElementById("env");
  env.textContent = state.environment.label.toUpperCase();
  env.className = `pill ${state.environment.mode === "prod" ? "prod" : ""}`;
  const stripe = document.getElementById("stripe");
  stripe.textContent = state.environment.stripe ? `Stripe ${state.environment.stripe}` : "No Stripe key";
  stripe.className = `pill ${state.environment.stripe ? "" : "off"}`;
  document.title = `Affiliates · ${state.environment.label}`;
  renderOverview();
  renderDetail();
}

function renderOverview() {
  const body = document.getElementById("overview");
  if (state.affiliates.length === 0) {
    body.replaceChildren(h("tr", {}, h("td", { colspan: 11, class: "empty" }, "No affiliates yet. Create one above.")));
    return;
  }
  body.replaceChildren(
    ...state.affiliates.map((a) => {
      const owedNegative = Object.values(a.owed).some((cents) => cents < 0);
      return h(
        "tr",
        {
          class: `row ${a.id === selectedId ? "selected" : ""}`,
          onclick: () => {
            selectedId = a.id === selectedId ? null : a.id;
            renderOverview();
            renderDetail();
          },
        },
        h(
          "td",
          {},
          h("div", {}, a.name, a.active ? null : h("span", { class: "pill off", style: "margin-left:8px" }, "paused")),
          h("div", { class: "dim mono" }, a.slug),
        ),
        h(
          "td",
          {},
          h("span", { class: "mono muted" }, a.link),
          h("button", { class: "link", title: "Copy link", onclick: (event) => (event.stopPropagation(), copy(a.link)) }, "copy"),
        ),
        h("td", { class: "num" }, a.stats.visitors),
        h("td", { class: "num" }, a.stats.accounts),
        h("td", { class: "num" }, a.stats.trials),
        h("td", { class: "num" }, a.stats.customers),
        h("td", { class: "num" }, moneyMap(a.revenue)),
        h("td", { class: "num" }, moneyMap(a.commission), a.stripeErrors ? h("span", { class: "err", title: "Some Stripe lookups failed — see detail" }, " ⚠") : null),
        h("td", { class: "num" }, moneyMap(a.paid)),
        h("td", { class: `num ${owedNegative ? "neg" : "owed"}` }, moneyMap(a.owed, { emptyAsZero: true })),
        h("td", { class: "num" }, h("button", { onclick: (event) => (event.stopPropagation(), startPayout(a.id)) }, "Mark paid")),
      );
    }),
  );
}

/** Opens the affiliate's detail and puts the cursor in the payout amount, prefilled with what's owed. */
function startPayout(id) {
  selectedId = id;
  renderOverview();
  renderDetail();
  const amount = document.querySelector('#detail input[name="amount"]');
  amount.scrollIntoView({ block: "center", behavior: "smooth" });
  amount.focus();
  amount.select();
}

function field(label, input, wide) {
  return h("label", { class: wide ? "wide" : undefined }, label, input);
}

function renderDetail() {
  const container = document.getElementById("detail");
  const a = state?.affiliates.find((affiliate) => affiliate.id === selectedId);
  if (!a) {
    container.replaceChildren();
    return;
  }

  // --- Edit ---
  const editError = h("span", { class: "err" });
  const edit = h(
    "form",
    {
      class: "grid",
      onsubmit: async (event) => {
        event.preventDefault();
        const form = new FormData(event.target);
        editError.textContent = "";
        try {
          await api("PATCH", `/api/affiliates/${a.id}`, {
            name: form.get("name"),
            contact: form.get("contact"),
            notes: form.get("notes"),
            landing_path: form.get("landing_path"),
            commission_bps: Math.round(Number(form.get("commission_pct")) * 100),
            commission_months: Number(form.get("commission_months")),
          });
          toast("Saved");
          await load();
        } catch (error) {
          editError.textContent = error.message;
        }
      },
    },
    field("Name", h("input", { name: "name", value: a.name, required: true })),
    field("Contact", h("input", { name: "contact", value: a.contact ?? "" })),
    field("Landing path", h("input", { name: "landing_path", value: a.landing_path })),
    field("Commission %", h("input", { name: "commission_pct", type: "number", min: 0, max: 100, step: 0.01, value: a.commission_bps / 100 })),
    field("Commission months", h("input", { name: "commission_months", type: "number", min: 1, max: 120, value: a.commission_months })),
    field("Notes", h("textarea", {}, a.notes ?? ""), true),
    h(
      "div",
      { class: "row-actions" },
      h("button", { class: "primary", type: "submit" }, "Save"),
      h(
        "button",
        {
          type: "button",
          onclick: async () => {
            try {
              await api("PATCH", `/api/affiliates/${a.id}`, { active: !a.active });
              toast(a.active ? "Paused — the link now lands without credit" : "Reactivated");
              await load();
            } catch (error) {
              editError.textContent = error.message;
            }
          },
        },
        a.active ? "Pause link" : "Reactivate link",
      ),
      editError,
    ),
  );
  edit.querySelector("textarea").name = "notes";

  // --- Payouts ---
  const payoutError = h("span", { class: "err" });
  const owedUsd = a.owed.usd ?? 0;
  const payoutForm = h(
    "form",
    {
      class: "grid",
      onsubmit: async (event) => {
        event.preventDefault();
        const form = new FormData(event.target);
        payoutError.textContent = "";
        try {
          const paidOn = form.get("paid_at");
          const payout = await api("POST", `/api/affiliates/${a.id}/payouts`, {
            amount_cents: Math.round(Number(form.get("amount")) * 100),
            currency: form.get("currency"),
            note: form.get("note"),
            ...(paidOn ? { paid_at: new Date(`${paidOn}T12:00:00`).toISOString() } : {}),
          });
          toast(`Marked ${money(payout.amount_cents, payout.currency)} paid to ${a.name}`);
          await load();
        } catch (error) {
          payoutError.textContent = error.message;
        }
      },
    },
    field("Amount", h("input", { name: "amount", type: "number", min: 0.01, step: 0.01, required: true, value: owedUsd > 0 ? (owedUsd / 100).toFixed(2) : "" })),
    field("Currency", h("input", { name: "currency", value: "usd", maxlength: 3 })),
    field("Paid on", h("input", { name: "paid_at", type: "date", value: new Date().toISOString().slice(0, 10) })),
    field("Note", h("input", { name: "note", placeholder: "PayPal ref, Wise transfer…" })),
    h("div", { class: "row-actions" }, h("button", { class: "primary", type: "submit" }, "Mark as paid"), payoutError),
  );

  const payoutsTable =
    a.payouts.length === 0
      ? h("p", { class: "empty" }, "Nothing paid yet.")
      : h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            {},
            h("thead", {}, h("tr", {}, h("th", {}, "Paid on"), h("th", { class: "num" }, "Amount"), h("th", {}, "Note"), h("th", {}))),
            h(
              "tbody",
              {},
              a.payouts.map((p) =>
                h(
                  "tr",
                  {},
                  h("td", {}, date(p.paid_at)),
                  h("td", { class: "num" }, money(p.amount_cents, p.currency)),
                  h("td", { class: "muted" }, p.note ?? ""),
                  h(
                    "td",
                    { class: "num" },
                    h(
                      "button",
                      {
                        class: "link",
                        onclick: async () => {
                          if (!window.confirm(`Delete the ${money(p.amount_cents, p.currency)} payout from ${date(p.paid_at)}?`)) return;
                          try {
                            await api("DELETE", `/api/payouts/${p.id}`, {});
                            toast("Payout deleted");
                            await load();
                          } catch (error) {
                            payoutError.textContent = error.message;
                          }
                        },
                      },
                      "delete",
                    ),
                  ),
                ),
              ),
            ),
          ),
        );

  // --- Referrals ---
  const referrals =
    a.referrals.length === 0
      ? h("p", { class: "empty" }, "No one has arrived through this link yet.")
      : h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            {},
            h(
              "thead",
              {},
              h(
                "tr",
                {},
                ["Clicked", "Account", "Downloaded", "Signed up", "Trial", "Paid", "Status"].map((t) => h("th", {}, t)),
                h("th", { class: "num" }, "Revenue"),
                h("th", { class: "num" }, "Commission"),
                h("th", {}, "Window ends"),
              ),
            ),
            h(
              "tbody",
              {},
              a.referrals.map((r) => {
                const paidAt = r.earnings?.firstPaidAt ?? r.paid_at ?? r.lifetime_purchased_at;
                return h(
                  "tr",
                  {},
                  h("td", {}, date(r.affiliate_at)),
                  h("td", { class: r.email ? "" : "dim" }, r.email ?? "anonymous"),
                  h("td", {}, date(r.downloaded_at)),
                  h("td", {}, date(r.signed_up_at)),
                  h("td", {}, date(r.trial_at)),
                  h("td", {}, date(paidAt)),
                  h("td", { class: "muted" }, r.lifetime_purchased_at ? "lifetime" : r.subscription_status ?? ""),
                  h(
                    "td",
                    { class: "num" },
                    r.stripeError ? h("span", { class: "err", title: r.stripeError }, "Stripe error") : moneyMap(r.earnings?.eligible),
                  ),
                  h("td", { class: "num" }, moneyMap(r.earnings?.commission)),
                  h("td", { class: "muted" }, date(r.earnings?.windowEndsAt)),
                );
              }),
            ),
          ),
        );

  container.replaceChildren(
    h(
      "section",
      {},
      h(
        "div",
        { class: "row-actions" },
        h("h2", { style: "margin:0" }, a.name),
        h("span", { class: "mono dim" }, a.slug),
        h("span", { class: "spacer" }),
        h("span", { class: "mono muted" }, a.link),
        h("button", { onclick: () => copy(a.link) }, "Copy link"),
      ),
      h(
        "p",
        { class: "note" },
        `${a.commission_bps / 100}% of net revenue for ${a.commission_months} months from each referral's first payment. ` +
          `First affiliate link a person clicks wins; later links never take the credit.`,
      ),
      h(
        "div",
        { class: "cols" },
        h("div", {}, h("h3", {}, "Settings"), edit),
        h("div", {}, h("h3", {}, `Record a payout — owed ${moneyMap(a.owed, { emptyAsZero: true })}`), payoutForm, payoutsTable),
      ),
      h("h3", {}, `Referrals (${a.referrals.length})`),
      referrals,
    ),
  );
}

document.getElementById("refresh").addEventListener("click", () => load().then(() => toast("Refreshed")));

document.getElementById("create").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const error = document.getElementById("create-error");
  error.textContent = "";
  try {
    const created = await api("POST", "/api/affiliates", {
      slug: form.get("slug"),
      name: form.get("name"),
      contact: form.get("contact"),
      notes: form.get("notes"),
      landing_path: form.get("landing_path"),
      commission_bps: Math.round(Number(form.get("commission_pct")) * 100),
      commission_months: Number(form.get("commission_months")),
    });
    event.target.reset();
    document.getElementById("create-panel").open = false;
    selectedId = created.id;
    await load();
    copy(state.affiliates.find((a) => a.id === created.id)?.link ?? "");
  } catch (err) {
    error.textContent = err.message;
  }
});

load();
