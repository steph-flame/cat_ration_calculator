"""
v3 expenditure model — Python research prototype (validate here, port to JS).

Motivation (from MacroFactor V3): separate *transient* weight moves from *real* changes
in expenditure, so the estimate is both more stable to noise AND more responsive to real
change. For a cat the transient is gut-fill / hydration / bladder — an intra-day offset
shared by every weigh-in that day (so averaging multiple reads kills sensor noise but NOT
this shared offset). We model it as a mean-reverting latent state.

State x = [W, E, T]:
    W_k = W_{k-1} + (I_k - E_{k-1})/rho     slow trend weight (energy balance)
    E_k = E_{k-1} + noise(q_E)              expenditure, slow random walk
    T_k = phi * T_{k-1} + noise(q_T)        transient (gut/hydration), mean-reverting
Measurement:
    z_k = W_k + T_k + noise(R)              observed daily weight = trend + transient + sensor

The v3 question: can the filter separate E (persistent slope) from T (mean-reverting bump)?
Run:  research/../scratchpad/venv/bin/python research/v3_expenditure.py
"""
import numpy as np

RHO = 7800.0  # kcal per kg of body-mass change (cat, fat-skewed) — matches src/lib/expenditure.js KCAL_PER_KG


class Kalman:
    """Minimal linear KF with a control input and scalar measurements."""
    def __init__(self, F, B, Q, H, x0, P0):
        self.F, self.B, self.Q, self.H = F, B, Q, H
        self.x, self.P = x0.astype(float), P0.astype(float)

    def step(self, u, z, R, gate=np.inf):
        # predict
        self.x = self.F @ self.x + self.B * u
        self.P = self.F @ self.P @ self.F.T + self.Q
        # update on a scalar measurement (skip if missing or gated as an outlier)
        if z is not None:
            y = z - (self.H @ self.x)
            S = float(self.H @ self.P @ self.H.T) + R
            if abs(y) <= gate:
                K = (self.P @ self.H.T) / S
                self.x = self.x + K * y
                self.P = (np.eye(len(self.x)) - np.outer(K, self.H)) @ self.P
                self.P = 0.5 * (self.P + self.P.T)
        return self.x.copy(), self.P.copy()


def model_v2(rho, qW, qE, prior_kcal, prior_sd, w0, R0):
    F = np.array([[1.0, -1.0 / rho], [0.0, 1.0]])
    B = np.array([1.0 / rho, 0.0])
    Q = np.diag([qW, qE])
    H = np.array([1.0, 0.0])
    x0 = np.array([w0, prior_kcal])
    P0 = np.diag([R0, prior_sd ** 2])
    return Kalman(F, B, Q, H, x0, P0)


def model_v3(rho, qW, qE, qT, phi, prior_kcal, prior_sd, w0, R0, transient_sd0):
    F = np.array([[1.0, -1.0 / rho, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, phi]])
    B = np.array([1.0 / rho, 0.0, 0.0])
    Q = np.diag([qW, qE, qT])
    H = np.array([1.0, 0.0, 1.0])
    x0 = np.array([w0, prior_kcal, 0.0])
    P0 = np.diag([R0, prior_sd ** 2, transient_sd0 ** 2])
    return Kalman(F, B, Q, H, x0, P0)


def synth(rng, days=70, intake=210.0, E_schedule=lambda d: 250.0, rho=RHO,
          w0=6.0, reads_per_day=3, phi_true=0.5, sigma_T=0.05, sigma_sensor=0.02):
    """True slow weight (energy balance) + AR(1) transient + per-read sensor noise."""
    w = w0
    T = 0.0
    daily_z, daily_R, true_E, true_W = [], [], [], []
    for d in range(days):
        e = E_schedule(d)
        T = phi_true * T + rng.normal(0, sigma_T)
        reads = [w + T + rng.normal(0, sigma_sensor) for _ in range(reads_per_day)]
        daily_z.append(np.mean(reads))
        daily_R.append(sigma_sensor ** 2 / reads_per_day)  # sensor noise beaten down by n reads
        true_E.append(e)
        true_W.append(w)
        w = w + (intake - e) / rho
    return dict(z=np.array(daily_z), R=np.array(daily_R), trueE=np.array(true_E),
                trueW=np.array(true_W), intake=intake)


def run(filt, data, gate_kg=0.3):
    Es, Ws = [], []
    for d in range(len(data["z"])):
        x, P = filt.step(data["intake"], data["z"][d], data["R"][d], gate=gate_kg)
        Es.append(x[1]); Ws.append(x[0])
    return np.array(Es), np.array(Ws), P


def metrics(Es, trueE, tail=21):
    err_tail = np.abs(Es[-tail:] - trueE[-tail:])
    wobble = np.std(np.diff(Es[-tail:]))  # day-to-day jumpiness of the estimate
    return dict(mae=float(np.mean(err_tail)), final_err=float(abs(Es[-1] - trueE[-1])), wobble=float(wobble))


def main():
    rng = np.random.default_rng(42)
    common = dict(rho=RHO, qW=1e-5, qE=2.0, prior_kcal=250.0, prior_sd=120.0, w0=6.0)
    v3_extra = dict(qT=0.0025, phi=0.5, transient_sd0=0.06)

    print("=== Scenario A: constant true E=260, with gut-fill transient ===")
    accA = {"v2": [], "v3": []}
    for trial in range(200):
        data = synth(rng, E_schedule=lambda d: 260.0)
        v2 = model_v2(R0=data["R"][0], **common)
        v3 = model_v3(R0=data["R"][0], **common, **v3_extra)
        e2, _, _ = run(v2, data); e3, _, _ = run(v3, data)
        accA["v2"].append(metrics(e2, data["trueE"])); accA["v3"].append(metrics(e3, data["trueE"]))
    for k in ("v2", "v3"):
        mae = np.mean([m["mae"] for m in accA[k]])
        wob = np.mean([m["wobble"] for m in accA[k]])
        print(f"  {k}: tail MAE {mae:6.2f} kcal   E-hat wobble {wob*1000:6.1f} (mkcal/day)")

    print("\n=== Scenario B: step change E 270 -> 230 at day 35 (responsiveness) ===")
    stepE = lambda d: 270.0 if d < 35 else 230.0
    lags = {"v2": [], "v3": []}
    for trial in range(200):
        data = synth(rng, days=80, E_schedule=stepE)
        v2 = model_v2(R0=data["R"][0], **common); v3 = model_v3(R0=data["R"][0], **common, **v3_extra)
        e2, _, _ = run(v2, data); e3, _, _ = run(v3, data)
        for k, e in (("v2", e2), ("v3", e3)):
            after = e[35:]
            reached = np.where(np.abs(after - 230.0) < 8.0)[0]
            lags[k].append(reached[0] if len(reached) else len(after))
    for k in ("v2", "v3"):
        print(f"  {k}: days to track step (within 8 kcal): {np.mean(lags[k]):.1f}")

    print("\n=== Scenario C: clean data, NO transient (v3 must not be worse) ===")
    accC = {"v2": [], "v3": []}
    for trial in range(200):
        data = synth(rng, E_schedule=lambda d: 250.0, sigma_T=0.0)
        v2 = model_v2(R0=data["R"][0], **common); v3 = model_v3(R0=data["R"][0], **common, **v3_extra)
        e2, _, _ = run(v2, data); e3, _, _ = run(v3, data)
        accC["v2"].append(metrics(e2, data["trueE"])["mae"]); accC["v3"].append(metrics(e3, data["trueE"])["mae"])
    print(f"  v2 tail MAE {np.mean(accC['v2']):.2f}   v3 tail MAE {np.mean(accC['v3']):.2f}")

    print("\n=== Scenario D: qE sweep for v3 — find 'stable AND responsive' ===")
    print("  (v2 baseline: stability wobble ~6.0, step lag ~19 days)")
    stepE = lambda d: 270.0 if d < 35 else 230.0
    for qE in (2.0, 5.0, 10.0, 20.0, 40.0):
        v3c = dict(common); v3c["qE"] = qE
        wob, lag = [], []
        for trial in range(200):
            dA = synth(rng, E_schedule=lambda d: 260.0)
            m = model_v3(R0=dA["R"][0], **v3c, **v3_extra); e, _, _ = run(m, dA)
            wob.append(metrics(e, dA["trueE"])["wobble"])
            dB = synth(rng, days=80, E_schedule=stepE)
            m2 = model_v3(R0=dB["R"][0], **v3c, **v3_extra); e2, _, _ = run(m2, dB)
            reached = np.where(np.abs(e2[35:] - 230.0) < 8.0)[0]
            lag.append(reached[0] if len(reached) else len(e2) - 35)
        print(f"  qE={qE:5.1f}:  stability wobble {np.mean(wob)*1000:6.1f}   step lag {np.mean(lag):5.1f} days")


if __name__ == "__main__":
    main()
