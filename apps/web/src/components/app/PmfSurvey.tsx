"use client";
import { useState } from "react";

type Disappointment = "very" | "somewhat" | "not";

const OPTIONS: { value: Disappointment; label: string }[] = [
  { value: "very", label: "Very disappointed" },
  { value: "somewhat", label: "Somewhat disappointed" },
  { value: "not", label: "Not disappointed" },
];

/**
 * Sean-Ellis PMF prompt: "how would you feel if you could no longer use Talysman?" The
 * %-"very disappointed" across all responses is the actual PMF number (40% is the classic
 * threshold) — this component only collects one response; the aggregate lives in the
 * dev dashboard's PMF panel.
 */
export function PmfSurvey() {
  const [disappointment, setDisappointment] = useState<Disappointment | null>(null);
  const [primaryBenefit, setPrimaryBenefit] = useState("");
  const [mainAlternative, setMainAlternative] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  if (status === "sent") {
    return (
      <aside className="account__pmf-survey">
        <p>Thanks — that helps us build the right thing.</p>
      </aside>
    );
  }

  async function submit() {
    if (!disappointment) return;
    setStatus("sending");
    const res = await fetch("/api/analytics/survey", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        disappointment,
        primary_benefit: primaryBenefit || undefined,
        main_alternative: mainAlternative || undefined,
      }),
    });
    setStatus(res.ok ? "sent" : "error");
  }

  return (
    <aside className="account__pmf-survey">
      <h2 className="account__pmf-survey-title">Quick question</h2>
      <p className="account__pmf-survey-prompt">
        How would you feel if you could no longer use Talysman?
      </p>
      <div role="radiogroup" aria-label="Disappointment level" className="account__pmf-survey-options">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={disappointment === opt.value}
            className={`account__pmf-survey-option${disappointment === opt.value ? " account__pmf-survey-option--on" : ""}`}
            onClick={() => setDisappointment(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {disappointment ? (
        <div className="account__pmf-survey-followups">
          <label>
            What&apos;s the main benefit you get from Talysman? (optional)
            <input
              type="text"
              maxLength={500}
              value={primaryBenefit}
              onChange={(e) => setPrimaryBenefit(e.target.value)}
            />
          </label>
          <label>
            What would you use instead? (optional)
            <input
              type="text"
              maxLength={200}
              value={mainAlternative}
              onChange={(e) => setMainAlternative(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="account__pmf-survey-submit"
            onClick={submit}
            disabled={status === "sending"}
          >
            {status === "sending" ? "Sending…" : "Submit"}
          </button>
          {status === "error" ? (
            <p className="account__pmf-survey-error">Couldn&apos;t send — please try again.</p>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
