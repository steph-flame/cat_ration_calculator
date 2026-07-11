# research/

Python prototypes for the harder estimators. The pattern: **prototype and validate a
model here (where NumPy/linear-algebra is pleasant and cross-checking is easy), tune its
parameters against synthetic data, then port the validated result to `src/lib/` in JS.**
The app itself stays pure client-side JS — this is a research bench, not a runtime
dependency.

## `v3_expenditure.py`

Validates the **v3 unobserved-components** expenditure model before it was ported to
`src/lib/expenditure.js` (`ucEstimateExpenditure`). It answers the question that made a
prototype worthwhile: *can a filter actually separate a mean-reverting gut-fill/hydration
transient from a real change in expenditure, or is the transient state unidentifiable?*

State `x = [W, E, T]` — trend weight, expenditure, and a mean-reverting transient;
measurement `z = W + T + sensor noise`. The script runs v2 (no transient) vs v3 across:

- **A** — constant true E with a gut-fill transient → v3 has ~3× lower estimate wobble and
  lower error than v2;
- **B** — a step change in E → responsiveness (this is where over-damping showed up);
- **C** — clean data, no transient → v3 must not be worse (it isn't);
- **D** — a `qE` sweep that maps the stability↔responsiveness frontier and picks the tuned
  value ported to JS (`qE=10, qT=0.0025, φ=0.5`).

The JS port carries the same synthetic-data assertions (`src/lib/v3.test.js`) as a
cross-language contract: the ported filter must reproduce the prototype's behaviour.

### Run

```bash
python3 -m venv venv && ./venv/bin/pip install numpy
./venv/bin/python v3_expenditure.py
```
(The `venv/` is git-ignored; nothing here is imported by the app.)
