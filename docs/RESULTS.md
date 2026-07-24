# DriftJS Benchmark Results & Framework Ladder

This document maintains official benchmark results for **DriftJS** against competing UI frameworks using the [`js-framework-benchmark`](https://github.com/krausest/js-framework-benchmark) (`webdriver-ts`) benchmark suite.

---

## 🏆 Level 1: Ember JS (`v6.12.0`) Comparison — DEFEATED

*Status: **DEFEATED** (DriftJS won 14 of 15 benchmarks).*

### 1. CPU Benchmarks (Duration in ms)
*Values reported as **Median Total Time** in milliseconds (with **Median Scripting Time** in parentheses).*

| Metric / Benchmark | VanillaJS | DriftJS (`v0.0.0`) | Ember (`v6.12.0`) | Result |
| :--- | :---: | :---: | :---: | :--- |
| **01. Create 1,000 rows** | `257.3` *(20.2)* | `271.3` *(39.3)* | `593.2` *(303.3)* | ✅ DriftJS (~2.2× faster) |
| **02. Replace 1,000 rows** | `248.1` *(36.6)* | `300.1` *(66.5)* | `662.7` *(384.5)* | ✅ DriftJS (~2.2× faster) |
| **03. Update every 10th row (1k)** | `150.9` *(5.0)* | `207.5` *(45.7)* | `238.2` *(89.6)* | ✅ DriftJS (~1.15× faster) |
| **04. Select row (1k)** | `49.1` *(3.0)* | `106.7` *(40.7)* | `101.4` *(67.6)* | ❌ Ember (~5% faster) |
| **05. Swap rows (1k)** | `176.3` *(2.0)* | `252.3` *(48.8)* | `310.3` *(92.8)* | ✅ DriftJS (~1.23× faster) |
| **06. Remove single row (1k)** | `151.1` *(2.4)* | `106.9` *(15.1)* | `202.3` *(52.2)* | ✅ DriftJS (~1.89× faster) |
| **07. Create 10,000 rows** | `2096.6` *(183.2)* | `2347.6` *(322.6)* | `4095.6` *(2141.6)* | ✅ DriftJS (~1.74× faster) |
| **08. Append 1,000 rows to 1k** | `281.4` *(17.9)* | `319.4` *(53.0)* | `657.7` *(341.8)* | ✅ DriftJS (~2.06× faster) |
| **09. Clear 1,000 rows** | `111.1` *(92.0)* | `132.4` *(112.7)* | `228.0` *(213.8)* | ✅ DriftJS (~1.72× faster) |

### 2. Memory Footprint (in MB)

| Metric / Benchmark | VanillaJS | DriftJS (`v0.0.0`) | Ember (`v6.12.0`) | Result |
| :--- | :---: | :---: | :---: | :--- |
| **21. Ready Memory** | `0.55` | `0.59` | `6.38` | ✅ DriftJS (~10.8× less memory) |
| **22. Run Memory (1k rows)** | `1.89` | `2.32` | `12.10` | ✅ DriftJS (~5.2× less memory) |
| **25. Run-Clear Memory** | `0.62` | `0.79` | `6.94` | ✅ DriftJS (~8.8× less memory) |

### 3. Implementation Size & Startup

| Metric / Benchmark | VanillaJS | DriftJS (`v0.0.0`) | Ember (`v6.12.0`) | Result |
| :--- | :---: | :---: | :---: | :--- |
| **41. Uncompressed Size (kB)** | `11.3` | `16.4` | `302.4` | ✅ DriftJS (~18.4× smaller) |
| **42. Compressed Size (kB)** | `2.5` | `4.9` | `80.5` | ✅ DriftJS (~16.4× smaller) |
| **43. First Paint (ms)** | `355.0` | `1179.2` | `1463.8` | ✅ DriftJS (~1.24× faster) |

---

## 🏆 Level 2: React 19 (`react-hooks`) Comparison — DEFEATED

*Status: **DEFEATED** (DriftJS won 11 of 15 benchmarks including 6/9 CPU benchmarks, all memory benchmarks, and bundle size).*

### 1. CPU Benchmarks (Duration in ms)

| Metric / Benchmark | VanillaJS | DriftJS (`v0.0.0`) | React 19 (`react-hooks`) | Result |
| :--- | :---: | :---: | :---: | :--- |
| **01. Create 1,000 rows** | `257.3` *(20.2)* | `195.5` *(29.7)* | `235.7` *(63.6)* | ✅ DriftJS (~20% faster) |
| **02. Replace 1,000 rows** | `248.1` *(36.6)* | `224.0` *(44.5)* | `264.5` *(76.6)* | ✅ DriftJS (~18% faster) |
| **03. Update every 10th row (1k)** | `150.9` *(5.0)* | `138.8` *(28.2)* | `133.0` *(25.3)* | ❌ React (~5 ms faster) |
| **04. Select row (1k)** | `49.1` *(3.0)* | `51.7` *(25.6)* | `37.3` *(14.8)* | ❌ React (~14 ms faster) |
| **05. Swap rows (1k)** | `176.3` *(2.0)* | `157.9` *(30.9)* | `841.7` *(112.8)* | ✅ DriftJS (~5.3× FASTER) |
| **06. Remove single row (1k)** | `151.1` *(2.4)* | `102.9` *(12.9)* | `92.1` *(7.0)* | ❌ React (~10 ms faster) |
| **07. Create 10,000 rows** | `2096.6` *(183.2)* | `1677.4` *(230.1)* | `2184.7` *(630.2)* | ✅ DriftJS (~1.3× FASTER) |
| **08. Append 1,000 rows to 1k** | `281.4` *(17.9)* | `203.1` *(33.8)* | `222.8` *(47.6)* | ✅ DriftJS (~10% faster) |
| **09. Clear 1,000 rows** | `111.1` *(92.0)* | `73.9` *(63.1)* | `126.8` *(113.9)* | ✅ DriftJS (~1.7× FASTER) |

### 2. Memory Footprint (in MB)

| Metric / Benchmark | VanillaJS | DriftJS (`v0.0.0`) | React 19 (`react-hooks`) | Result |
| :--- | :---: | :---: | :---: | :--- |
| **21. Ready Memory** | `0.55` | `0.59` | `1.17` | ✅ DriftJS (~2× less memory) |
| **22. Run Memory (1k rows)** | `1.89` | `2.32` | `4.46` | ✅ DriftJS (~1.9× less memory) |
| **25. Run-Clear Memory** | `0.62` | `0.79` | `1.94` | ✅ DriftJS (~2.5× less memory) |

### 3. Implementation Size & Startup

| Metric / Benchmark | VanillaJS | DriftJS (`v0.0.0`) | React 19 (`react-hooks`) | Result |
| :--- | :---: | :---: | :---: | :--- |
| **41. Uncompressed Size (kB)** | `11.3` | `14.8` | `190.3` | ✅ DriftJS (~12.8× smaller) |
| **42. Compressed Size (kB)** | `2.5` | `5.0` | `51.4` | ✅ DriftJS (~10.3× smaller) |
| **43. First Paint (ms)** | `172.1` | `465.7` | `615.4` | ✅ DriftJS (~1.3× FASTER) |

---

## 🏆 Progression Ladder Summary

- [x] **Level 1: Ember JS (`v6.12.0`)** — **DEFEATED** (Won 14/15 benchmarks)
- [x] **Level 2: React 19 (`react-hooks`)** — **DEFEATED** (Won 11/15 benchmarks)
- [ ] **Level 3: Vue** — *Next Opponent*
- [ ] **Level 4: Svelte** — *Locked*
- [ ] **Level 5: SolidJS** — *Final Boss*

---

## ⚙️ Benchmark Environment

- **Runner:** `webdriver-ts` (Puppeteer runner, Headless Chrome)
- **Browser Binary:** `/usr/bin/google-chrome`
- **Node.js:** `v22.22.3`
- **Date Recorded:** July 24, 2026
