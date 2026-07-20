"""
v3 φ-misspecification sweep — how much does the unobserved-components estimate degrade
when the ASSUMED transient timescale (φ, hardcoded 0.5 in production) doesn't match the
cat's TRUE gut-fill/hydration timescale?

The original v3_expenditure.py validated identifiability only in the self-consistent case
(phi_true == phi_assumed). This asks the question that actually matters for a real cat:
we never know its true φ, and a wet-vs-dry diet gives a large hydration swing on a ~4 kg
body. Three experiments:

  1. 1D sweep — fix assumed φ = 0.5 (production), vary true φ, at a REALISTIC transient
     amplitude. Compare v3 to v2 (no transient state = the "ignore it" baseline).
  2. 2D surface — assumed φ × true φ, to check whether 0.5 is a sensible minimax choice.
  3. Sustained regime change — a persistent step in hydration baseline (NOT mean-reverting
     to zero), which an AR(1)-to-zero transient structurally cannot hold. Measures the E
     bias and recovery time this induces.

Run:  research/../scratchpad/venv/bin/python research/v3_phi_misspec.py
"""
import numpy as np
from v3_expenditure import RHO, model_v2, model_v3, run, metrics

# Realistic transient amplitude. The original synth used sigma_T=0.05 kg (per-step innovation
# SD); the feasibility notes put real daily gut/water swing at ±100–150 g on ~4 kg. We test at
# 0.10 kg to stress the filter closer to reality. qT stays at production's 0.0025 (innovation
# var → 0.05 kg SD) so the filter is AMPLITUDE-mismatched too, as it is in real life.
COMMON = dict(rho=RHO, qW=1e-5, qE=10.0, prior_kcal=250.0, prior_sd=120.0, w0=4.2)
V3_EXTRA = dict(qT=0.0025, transient_sd0=0.06)
REALISTIC_SIGMA_T = 0.10
TRIALS = 300


def synth_phi(rng, days=70, intake=210.0, E=260.0, phi_true=0.5, sigma_T=REALISTIC_SIGMA_T,
              sigma_sensor=0.02, reads_per_day=3, w0=4.2, step_day=None, step_kg=0.0):
    """Slow energy-balance weight + AR(1) transient with a CONFIGURABLE true φ.

    step_day/step_kg optionally add a persistent (non-reverting) offset to the hydration
    baseline from step_day onward — the sustained diet-change regime the AR(1)-to-zero T
    can't represent.
    """
    w, T = w0, 0.0
    z, R, trueE, trueW = [], [], [], []
    for d in range(days):
        T = phi_true * T + rng.normal(0, sigma_T)
        baseline = step_kg if (step_day is not None and d >= step_day) else 0.0
        offset = T + baseline
        reads = [w + offset + rng.normal(0, sigma_sensor) for _ in range(reads_per_day)]
        z.append(np.mean(reads))
        R.append(sigma_sensor ** 2 / reads_per_day)
        trueE.append(E); trueW.append(w)
        w = w + (intake - E) / RHO
    return dict(z=np.array(z), R=np.array(R), trueE=np.array(trueE), trueW=np.array(trueW), intake=intake)


def eval_filter(build, phi_assumed_data, extra=None):
    """Mean tail metrics for a filter builder over TRIALS synthetic runs."""
    pass  # replaced by inline loops below for clarity


def exp1_1d_sweep():
    print("=" * 74)
    print("EXP 1 — assumed φ = 0.50 (production), TRUE φ varies; realistic amplitude 0.10 kg")
    print("        v2 = no transient state (ignore it); v3 = UC filter, assumed φ=0.5")
    print("        E-hat is 21-day tail vs true E=260. wobble = day-to-day |ΔÊ| (mkcal/day)")
    print("-" * 74)
    print(f"  {'true φ':>7} | {'v2 MAE':>7} {'v2 wob':>7} | {'v3 MAE':>7} {'v3 wob':>7} | {'v3 vs v2':>9}")
    for phi_true in (0.0, 0.2, 0.4, 0.5, 0.6, 0.8, 0.95):
        m2, w2, m3, w3 = [], [], [], []
        rng = np.random.default_rng(7)
        for _ in range(TRIALS):
            data = synth_phi(rng, phi_true=phi_true)
            f2 = model_v2(R0=data["R"][0], qW=COMMON["qW"], qE=COMMON["qE"], rho=RHO,
                          prior_kcal=COMMON["prior_kcal"], prior_sd=COMMON["prior_sd"], w0=COMMON["w0"])
            f3 = model_v3(R0=data["R"][0], phi=0.5, **COMMON, **V3_EXTRA)
            e2, _, _ = run(f2, data); e3, _, _ = run(f3, data)
            a2, a3 = metrics(e2, data["trueE"]), metrics(e3, data["trueE"])
            m2.append(a2["mae"]); w2.append(a2["wobble"]); m3.append(a3["mae"]); w3.append(a3["wobble"])
        rel = (np.mean(m3) - np.mean(m2)) / np.mean(m2) * 100
        tag = f"{rel:+.0f}% MAE"
        print(f"  {phi_true:>7.2f} | {np.mean(m2):>7.2f} {np.mean(w2)*1000:>7.1f} | "
              f"{np.mean(m3):>7.2f} {np.mean(w3)*1000:>7.1f} | {tag:>9}")


def exp2_2d_surface():
    print("\n" + "=" * 74)
    print("EXP 2 — assumed φ (rows) × true φ (cols): 21-day tail MAE (kcal). Is 0.5 minimax?")
    print("-" * 74)
    trues = (0.0, 0.3, 0.5, 0.7, 0.9)
    assumeds = (0.0, 0.3, 0.5, 0.7, 0.9)
    print("  assumed\\true " + "".join(f"{t:>8.1f}" for t in trues) + "   | row-worst")
    for pa in assumeds:
        row = []
        for pt in trues:
            rng = np.random.default_rng(7)
            maes = []
            for _ in range(TRIALS):
                data = synth_phi(rng, phi_true=pt)
                f3 = model_v3(R0=data["R"][0], phi=pa, **COMMON, **V3_EXTRA)
                e3, _, _ = run(f3, data)
                maes.append(metrics(e3, data["trueE"])["mae"])
            row.append(np.mean(maes))
        star = " *" if pa == 0.5 else "  "
        print(f"  {pa:>10.1f}{star}" + "".join(f"{v:>8.2f}" for v in row) + f"   | {max(row):>7.2f}")


def exp3_regime_change():
    print("\n" + "=" * 74)
    print("EXP 3 — sustained hydration step (+0.12 kg at day 35): the non-reverting regime")
    print("        an AR(1)-to-zero T can't hold. True E constant=260 throughout.")
    print("        Reports peak |Ê−260| in days 35–55 and days to settle back within 8 kcal.")
    print("-" * 74)
    for label, build in (("v2 (no T)", "v2"), ("v3 (φ=0.5)", "v3")):
        peaks, settles = [], []
        rng = np.random.default_rng(7)
        for _ in range(TRIALS):
            data = synth_phi(rng, days=75, E=260.0, phi_true=0.5, step_day=35, step_kg=0.12)
            if build == "v2":
                f = model_v2(R0=data["R"][0], qW=COMMON["qW"], qE=COMMON["qE"], rho=RHO,
                             prior_kcal=COMMON["prior_kcal"], prior_sd=COMMON["prior_sd"], w0=COMMON["w0"])
            else:
                f = model_v3(R0=data["R"][0], phi=0.5, **COMMON, **V3_EXTRA)
            e, _, _ = run(f, data)
            window = e[35:55]
            peaks.append(np.max(np.abs(window - 260.0)))
            after = np.abs(e[35:] - 260.0)
            back = np.where(after < 8.0)[0]
            # first day AFTER the step where it's within 8 and stays (approx: first re-entry)
            reentry = next((i for i in range(len(after)) if after[i] < 8.0 and i > 3), len(after))
            settles.append(reentry)
        print(f"  {label:>12}: peak E bias {np.mean(peaks):6.1f} kcal   settle {np.mean(settles):5.1f} days")


def exp4_responsiveness_frontier():
    print("\n" + "=" * 74)
    print("EXP 4 — the φ FRONTIER: does a higher assumed φ wreck responsiveness to a REAL")
    print("        change in E? True E steps 270→230 at day 35; true φ=0.5 fixed.")
    print("        Higher φ = T more willing to absorb persistence — including real E moves.")
    print("-" * 74)
    stepE = None  # E schedule is applied via a modified synth below
    print(f"  {'assumed φ':>9} | {'step lag':>9} | {'const-E wobble':>14}")
    for pa in (0.3, 0.5, 0.7, 0.9, 0.97):
        lags, wobs = [], []
        rng = np.random.default_rng(7)
        for _ in range(TRIALS):
            # responsiveness: a genuine E step (built by overriding trueE post-hoc via synth on
            # two segments would drift W wrong; instead simulate with a time-varying E inline)
            data = _synth_estep(rng, days=80, phi_true=0.5, e_before=270.0, e_after=230.0, step_day=35)
            f = model_v3(R0=data["R"][0], phi=pa, **COMMON, **V3_EXTRA)
            e, _, _ = run(f, data)
            after = e[35:]
            reached = np.where(np.abs(after - 230.0) < 8.0)[0]
            lags.append(reached[0] if len(reached) else len(after))
            # stability: constant E, same assumed φ
            dC = synth_phi(rng, E=260.0, phi_true=0.5)
            fC = model_v3(R0=dC["R"][0], phi=pa, **COMMON, **V3_EXTRA)
            eC, _, _ = run(fC, dC)
            wobs.append(metrics(eC, dC["trueE"])["wobble"])
        print(f"  {pa:>9.2f} | {np.mean(lags):>7.1f}d  | {np.mean(wobs)*1000:>12.1f}")


def _synth_estep(rng, days, phi_true, e_before, e_after, step_day,
                 intake=210.0, sigma_T=REALISTIC_SIGMA_T, sigma_sensor=0.02, reads_per_day=3, w0=4.2):
    """Synthetic run with a genuine step in true E (energy balance integrates the changing E)."""
    w, T = w0, 0.0
    z, R, trueE, trueW = [], [], [], []
    for d in range(days):
        E = e_before if d < step_day else e_after
        T = phi_true * T + rng.normal(0, sigma_T)
        reads = [w + T + rng.normal(0, sigma_sensor) for _ in range(reads_per_day)]
        z.append(np.mean(reads)); R.append(sigma_sensor ** 2 / reads_per_day)
        trueE.append(E); trueW.append(w)
        w = w + (intake - E) / RHO
    return dict(z=np.array(z), R=np.array(R), trueE=np.array(trueE), trueW=np.array(trueW), intake=intake)


if __name__ == "__main__":
    print(f"ρ = {RHO} kcal/kg (matches production)   trials/cell = {TRIALS}")
    exp1_1d_sweep()
    exp2_2d_surface()
    exp3_regime_change()
    exp4_responsiveness_frontier()
