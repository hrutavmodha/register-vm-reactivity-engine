# DriftJS Benchmark Results & Progression Ladder

This document tracks official benchmark comparisons for **DriftJS** using the [`js-framework-benchmark`](https://github.com/krausest/js-framework-benchmark) (`webdriver-ts`) suite.

---

## 🏆 Level 1: Ember JS (`v6.12.0`) Comparison — DEFEATED

*Status: **DEFEATED** (DriftJS won 14 of 15 benchmarks).*

### 1. CPU Benchmarks (Duration in ms)
*Values reported as **Median Total Time** in milliseconds (with **Median Scripting Time** in parentheses).*

| Metric / Benchmark | VanillaJS | DriftJS (`v0.0.0`) | Ember (`v6.12.0`) | Result |
| :--- | :---: | :---: | :---: | :---: |
| **01. Create 1,000 rows** | `257.3` *(20.2)* | `271.3` *(39.3)* | `593.2` *(303.3)* | ⚡ **DriftJS (~2.2× faster)** |
| **02. Replace 1,000 rows** | `248.1` *(36.6)* | `300.1` *(66.5)* | `662.7` *(384.5)* | ⚡ **DriftJS (~2.2× faster)** |
| **03. Update every 10th row (1k)** | `150.9` *(5.0)* | `207.5` *(45.7)* | `238.2` *(89.6)* | ⚡ **DriftJS (~1.15× faster)** |
| **04. Select row (1k)** | `49.1` *(3.0)* | `106.7` *(40.7)* | `101.4` *(67.6)* | 🎯 **Ember (~5% faster on total)** |
| **05. Swap rows (1k)** | `176.3` *(2.0)* | `252.3` *(48.8)* | `310.3` *(92.8)* | ⚡ **DriftJS (~1.23× faster)** |
| **06. Remove single row (1k)** | `151.1` *(2.4)* | `106.9` *(15.1)* | `202.3` *(52.2)* | ⚡ **DriftJS (~1.89× faster)** |
| **07. Create 10,000 rows** | `2096.6` *(183.2)* | `2347.6` *(322.6)* | `4095.6` *(2141.6)* | ⚡ **DriftJS (~1.74× faster)** |
| **08. Append 1,000 rows to 1k** | `281.4` *(17.9)* | `319.4` *(53.0)* | `657.7` *(341.8)* | ⚡ **DriftJS (~2.06× faster)** |
| **09. Clear 1,000 rows** | `111.1` *(92.0)* | `132.4` *(112.7)* | `228.0` *(213.8)* | ⚡ **DriftJS (~1.72× faster)** |

### 2. Memory Footprint (in MB)

| Metric / Benchmark | VanillaJS | DriftJS (`v0.0.0`) | Ember (`v6.12.0`) | Result |
| :--- | :---: | :---: | :---: | :---: |
| **21. Ready Memory** | `0.55` | `0.59` | `6.38` | 🧠 **DriftJS (~10.8× less memory)** |
| **22. Run Memory (1k rows)** | `1.89` | `2.32` | `12.10` | 🧠 **DriftJS (~5.2× less memory)** |
| **25. Run-Clear Memory** | `0.62` | `0.79` | `6.94` | 🧠 **DriftJS (~8.8× less memory)** |

### 3. Implementation Size & Startup

| Metric / Benchmark | VanillaJS | DriftJS (`v0.0.0`) | Ember (`v6.12.0`) | Result |
| :--- | :---: | :---: | :---: | :---: |
| **41. Uncompressed Size (kB)** | `11.3` | `16.4` | `302.4` | 📦 **DriftJS (~18.4× smaller)** |
| **42. Compressed Size (kB)** | `2.5` | `4.9` | `80.5` | 📦 **DriftJS (~16.4× smaller)** |
| **43. First Paint (ms)** | `355.0` | `1179.2` | `1463.8` | 🎨 **DriftJS (~1.24× faster)** |

---

## ⚔️ Level 2: React (`react-hooks`) Comparison (Pending)

*Status: **UP NEXT** — Benchmarks to be run.*

### 1. CPU Benchmarks (Duration in ms)

| Metric / Benchmark | VanillaJS | DriftJS (`v0.0.0`) | React (`react-hooks`) | Delta |
| :--- | :---: | :---: | :---: | :---: |
| **01. Create 1,000 rows** | `257.3` *(20.2)* | *Pending* | *Pending* | *Pending* |
| **02. Replace 1,000 rows** | `248.1` *(36.6)* | *Pending* | *Pending* | *Pending* |
| **03. Update every 10th row (1k)** | `150.9` *(5.0)* | *Pending* | *Pending* | *Pending* |
| **04. Select row (1k)** | `49.1` *(3.0)* | *Pending* | *Pending* | *Pending* |
| **05. Swap rows (1k)** | `176.3` *(2.0)* | *Pending* | *Pending* | *Pending* |
| **06. Remove single row (1k)** | `151.1` *(2.4)* | *Pending* | *Pending* | *Pending* |
| **07. Create 10,000 rows** | `2096.6` *(183.2)* | *Pending* | *Pending* | *Pending* |
| **08. Append 1,000 rows to 1k** | `281.4` *(17.9)* | *Pending* | *Pending* | *Pending* |
| **09. Clear 1,000 rows** | `111.1` *(92.0)* | *Pending* | *Pending* | *Pending* |

### 2. Memory Footprint (in MB)

| Metric / Benchmark | VanillaJS | DriftJS (`v0.0.0`) | React (`react-hooks`) | Delta |
| :--- | :---: | :---: | :---: | :---: |
| **21. Ready Memory** | `0.55` | *Pending* | *Pending* | *Pending* |
| **22. Run Memory (1k rows)** | `1.89` | *Pending* | *Pending* | *Pending* |
| **25. Run-Clear Memory** | `0.62` | *Pending* | *Pending* | *Pending* |

### 3. Implementation Size & Startup

| Metric / Benchmark | VanillaJS | DriftJS (`v0.0.0`) | React (`react-hooks`) | Delta |
| :--- | :---: | :---: | :---: | :---: |
| **41. Uncompressed Size (kB)** | `11.3` | *Pending* | *Pending* | *Pending* |
| **42. Compressed Size (kB)** | `2.5` | *Pending* | *Pending* | *Pending* |
| **43. First Paint (ms)** | `355.0` | *Pending* | *Pending* | *Pending* |

---

## ⚙️ Benchmark Environment

- **Runner:** `webdriver-ts` (Puppeteer runner, Headless Chrome)
- **Browser Binary:** `/usr/bin/google-chrome`
- **Node.js:** `v22.22.3`
