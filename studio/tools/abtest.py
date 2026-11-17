#!/usr/bin/env python3
"""abtest.py: which thumbnail or title is ahead on YouTube's own numbers, and is that enough to call it? No model, no credits, no random numbers.

  python3 abtest.py --a <clicks> <impressions> --b <clicks> <impressions> [--c <clicks> <impressions>] [--metric thumbnail] [--min-impressions 1000] [--json]
  python3 abtest.py --selftest

  clicks       the number YouTube Studio shows as clicks (impressions x click-through rate); impressions is the number of times it was shown.
               Studio's "Test and compare" screen shows the share and the watch-time winner; this tool works from the raw counts so the call
               is the same every time. Up to three variants (YouTube tests up to three thumbnails).

The maths: each variant's true click-through rate gets a Beta(1 + clicks, 1 + impressions - clicks) posterior (a flat start). P(A beats B) is
worked out by exact numeric integration of  integral pdf_A(x) * cdf_B(x) dx  (no random numbers: the same counts always give the same answer).

The rule, the same every time:
  1. Every variant needs at least --min-impressions impressions (default 1000). Below that: keep testing.
  2. Call a winner only when the variant with the best click-through rate beats EACH of the others with a probability of 95 percent or
     more (with three variants that is two pairwise comparisons against the best).
  3. Otherwise: "keep testing, need about N more impressions each", N from the rates seen so far. If the rates are so close that it
     would take more than 2,000,000 impressions each, it says there is no real difference: stop and pick on something else.
A 95 percent call is wrong about one time in twenty, and a little more often with three variants. Look when each variant has the
impressions it needs, not every hour. This reads clicks only; watch time and audience retention are a second question."""
import json
import math
import sys

CALL = 0.95
MIN_IMPRESSIONS = 1000
GIVE_UP = 2_000_000
NAMES = 'ABC'


def _logpdf(x, a, b):
    return (a - 1) * math.log(x) + (b - 1) * math.log1p(-x) - (math.lgamma(a) + math.lgamma(b) - math.lgamma(a + b))


def prob_a_beats_b(ca, na, cb, nb, steps=6000):
    """P(rate A > rate B) with flat Beta priors, by numeric integration over the range where either posterior has mass."""
    if min(na, nb) <= 0 or ca < 0 or cb < 0 or ca > na or cb > nb:
        raise ValueError('clicks must be between 0 and impressions, and impressions above 0')
    pa, qa = 1 + ca, 1 + na - ca
    pb, qb = 1 + cb, 1 + nb - cb

    def span(p, q):
        mean = p / (p + q)
        sd = math.sqrt(p * q / ((p + q) ** 2 * (p + q + 1)))
        return max(1e-9, mean - 12 * sd), min(1 - 1e-9, mean + 12 * sd)

    (a0, a1), (b0, b1) = span(pa, qa), span(pb, qb)
    lo, hi = min(a0, b0), max(a1, b1)
    h = (hi - lo) / steps
    xs = [lo + (i + 0.5) * h for i in range(steps)]
    fa = [math.exp(_logpdf(x, pa, qa)) for x in xs]
    fb = [math.exp(_logpdf(x, pb, qb)) for x in xs]
    cum = total = 0.0
    for i in range(steps):
        total += fa[i] * (cum + 0.5 * fb[i] * h) * h
        cum += fb[i] * h
    return min(1.0, max(0.0, total / (sum(fa) * h)))


def more_needed(c_lead, n_lead, c_other, n_other, target=CALL):
    """If the rates seen so far hold, impressions EACH variant needs before the leader beats the other at `target`. 0 = already, None = never in practice."""
    rl, ro = c_lead / n_lead, c_other / n_other
    if rl <= ro:
        return None
    n = max(n_lead, n_other)

    def p_at(m):
        return prob_a_beats_b(rl * m, m, ro * m, m, steps=3000)

    if p_at(n) >= target:
        return 0
    lo, hi = n, n
    while p_at(hi) < target:
        lo, hi = hi, hi * 2
        if hi > GIVE_UP:
            return None
    while hi - lo > max(10, lo // 50):
        mid = (lo + hi) // 2
        if p_at(mid) >= target:
            hi = mid
        else:
            lo = mid
    return max(0, int(math.ceil(hi / 10.0) * 10) - n)


def decide(variants, min_impressions=MIN_IMPRESSIONS, metric='thumbnail'):
    """variants: [(clicks, impressions), ...] 2 or 3 -> dict with verdict, text and numbers."""
    if not 2 <= len(variants) <= 3:
        raise ValueError('give two or three variants (--a, --b and optionally --c)')
    for c, n in variants:
        if n <= 0 or c < 0 or c > n:
            raise ValueError('clicks must be between 0 and impressions, and impressions above 0')
    names = NAMES[:len(variants)]
    rates = [c / n for c, n in variants]
    best = max(range(len(variants)), key=lambda i: (rates[i], variants[i][1]))
    pct = lambda r: f'{100 * r:.2f}%'
    out = {'metric': metric, 'variants': [{'name': names[i], 'clicks': variants[i][0], 'impressions': variants[i][1], 'ctr': rates[i]} for i in range(len(variants))],
           'leader': names[best], 'min_impressions': min_impressions}
    lines = [f'{metric}: ' + ', '.join(f'{names[i]} {variants[i][0]} clicks in {variants[i][1]:,} impressions ({pct(rates[i])} CTR)' for i in range(len(variants))) + '.']
    pairs = []
    for i in range(len(variants)):
        if i == best:
            continue
        p = prob_a_beats_b(variants[best][0], variants[best][1], variants[i][0], variants[i][1])
        pairs.append({'other': names[i], 'p_leader_beats': p, 'index': i})
        lines.append(f'Chance that {names[best]} is really better than {names[i]}: {100 * p:.1f}%.')
    out['pairs'] = [{k: v for k, v in p.items() if k != 'index'} for p in pairs]
    short = [(names[i], variants[i][1]) for i in range(len(variants)) if variants[i][1] < min_impressions]
    if short:
        need = max(min_impressions - v for _, v in short)
        out.update(verdict='keep testing', more_impressions_each=need)
        lines.append(f'Keep testing: every variant needs at least {min_impressions:,} impressions and {", ".join(f"{n} has {v:,}" for n, v in short)}. Need about {need:,} more impressions each, then read it again.')
    elif all(p['p_leader_beats'] >= CALL for p in pairs):
        out.update(verdict=f'{names[best]} wins', more_impressions_each=0)
        worst = min(p['p_leader_beats'] for p in pairs)
        lines.append(f'{names[best]} wins: {100 * worst:.1f}% against its closest rival is above the 95% bar, with at least {min_impressions:,} impressions each. Keep the winner; the others were trials.')
    else:
        needs = []
        for p in pairs:
            if p['p_leader_beats'] >= CALL:
                needs.append((p['other'], 0))
            else:
                needs.append((p['other'], more_needed(variants[best][0], variants[best][1], variants[p['index']][0], variants[p['index']][1])))
        unsure = [(o, n) for o, n in needs if n != 0]
        finite = [n for _, n in unsure if n is not None]
        tied = [o for o, n in unsure if n is None]
        if not finite:
            out.update(verdict='no real difference', more_impressions_each=None)
            lost = [o for o, n in needs if n == 0]
            if lost:
                lines.append(f'{" and ".join(lost)} {"is" if len(lost) == 1 else "are"} clearly behind: drop {"it" if len(lost) == 1 else "them"}.')
            lines.append(f'No real difference: {names[best]} is ahead at the rates so far, but {" and ".join(tied)} {"is" if len(tied) == 1 else "are"} so close that it would take over {GIVE_UP:,} impressions each to tell them apart. Stop the test and pick on something else (taste, brand fit, watch time).')
        else:
            more = max(finite)
            out.update(verdict='keep testing', more_impressions_each=more, indistinguishable=tied)
            lines.append(f'Keep testing: {names[best]} is ahead but is not yet 95% sure against {", ".join(o for o, _ in unsure)}. Need about {more:,} more impressions each if the rates hold.')
            if tied:
                lines.append(f'{" and ".join(tied)} looks the same as {names[best]} at these rates: drop it and spend the impressions on the others.')
    out['text'] = '\n'.join(lines)
    return out


def selftest():
    bad = 0

    def expect(cond, msg):
        nonlocal bad
        if not cond:
            print('FAIL selftest: ' + str(msg))
            bad += 1

    close = lambda x, y, tol=0.004: abs(x - y) <= tol
    expect(close(prob_a_beats_b(50, 1000, 50, 1000), 0.5, 1e-6), 'equal counts give 0.5')
    expect(close(prob_a_beats_b(60, 1000, 40, 1000) + prob_a_beats_b(40, 1000, 60, 1000), 1.0, 1e-6), 'symmetry')
    # worked by hand: 1 of 1 against 0 of 1 is Beta(2,1) against Beta(1,2): 5/6. 2 of 2 against 0 of 2: 0.95.
    expect(close(prob_a_beats_b(1, 1, 0, 1), 5 / 6, 0.002), prob_a_beats_b(1, 1, 0, 1))
    expect(close(prob_a_beats_b(2, 2, 0, 2), 0.95, 0.002), prob_a_beats_b(2, 2, 0, 2))
    # a clear win
    r = decide([(900, 10000), (600, 10000)])
    expect(r['verdict'] == 'A wins', r)
    expect(decide([(600, 10000), (900, 10000)])['verdict'] == 'B wins', 'B can win')
    # a near-tie is not called
    r = decide([(550, 10000), (500, 10000)])
    expect(r['verdict'] == 'keep testing' and r['more_impressions_each'] > 0, r)
    # too few impressions: never a call, however big the gap
    r = decide([(300, 800), (50, 800)])
    expect(r['verdict'] == 'keep testing' and r['more_impressions_each'] == 200, r)
    # identical rates: no real difference
    expect(decide([(500, 10000), (500, 10000)])['verdict'] == 'no real difference', 'identical rates')
    # more impressions at the same gap turn the near-tie into a call
    need = decide([(550, 10000), (500, 10000)])['more_impressions_each']
    m = 10000 + need
    expect(prob_a_beats_b(0.055 * m, m, 0.05 * m, m) >= 0.93, 'needing ' + str(need))
    # three variants: the best has to beat both
    r = decide([(900, 10000), (600, 10000), (610, 10000)])
    expect(r['verdict'] == 'A wins' and len(r['pairs']) == 2, r)
    r = decide([(900, 10000), (600, 10000), (880, 10000)])
    expect(r['verdict'] == 'keep testing' and 'C' in r['text'], r)
    r = decide([(900, 10000), (600, 10000), (900, 10000)])
    expect(r['verdict'] == 'no real difference' and 'B is clearly behind' in r['text'], r)
    # bad numbers are refused
    for bad_in in ([(5, 0), (1, 10)], [(11, 10), (1, 10)], [(-1, 10), (1, 10)], [(1, 10)]):
        try:
            decide(bad_in)
        except ValueError:
            continue
        expect(False, f'{bad_in} should be refused')
    print('abtest selftest: ' + ('FAIL' if bad else 'OK'))
    return 1 if bad else 0


def parse(argv):
    variants, opts, i = {}, {'metric': 'thumbnail', 'min': MIN_IMPRESSIONS, 'json': False}, 0
    while i < len(argv):
        a = argv[i]
        if a in ('--a', '--b', '--c'):
            variants[a[2]] = (int(argv[i + 1]), int(argv[i + 2]))
            i += 3
        elif a == '--metric':
            opts['metric'] = argv[i + 1]
            i += 2
        elif a == '--min-impressions':
            opts['min'] = int(argv[i + 1])
            i += 2
        elif a == '--json':
            opts['json'] = True
            i += 1
        else:
            raise ValueError(f'unknown argument {a}')
    if 'a' not in variants or 'b' not in variants:
        raise ValueError('give at least --a and --b')
    return [variants[k] for k in 'abc' if k in variants], opts


def main(argv):
    if '--selftest' in argv:
        return selftest()
    try:
        variants, opts = parse(argv)
        res = decide(variants, opts['min'], opts['metric'])
    except (ValueError, IndexError) as e:
        print(f'abtest: {e}\n')
        print(__doc__)
        return 2
    print(json.dumps(res, indent=1) if opts['json'] else res['text'])
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
