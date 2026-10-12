# Analisis Four Factors Top 4 (Semifinalis Putra)
## DBL DI Jogjakarta Series 2026 (Kompetisi 49607)

Dokumen ini memuat hasil perhitungan metrik analitik **Four Factors (Dean Oliver)** untuk empat tim semifinalis (Fantastic Four) putra: **SMA BOPKRI 1 YOGYAKARTA**, **SMA OLIFANT**, **SMA BUDI UTAMA**, dan **SMA NEGERI 4 YOGYAKARTA**.

---

## 1. Metodologi & Bobot Analitik (Dean Oliver)

Four Factors adalah empat indikator utama penentu kemenangan dalam analitik bola basket modern dengan bobot pengaruh:

| Faktor | Bobot | Rumus Ofensif (Menyerang) | Rumus Defensif (Bertahan) |
| :--- | :---: | :--- | :--- |
| **1. Shooting (eFG%)** | **40%** | $\frac{\text{FGM} + 0.5 \times \text{3PM}}{\text{FGA}}$ | $100\% - \text{Opponent eFG\%}$ |
| **2. Turnovers (TOV%)** | **25%** | $100\% - \frac{\text{TOV}}{\text{FGA} + 0.44 \times \text{FTA} + \text{TOV}}$ | $\text{Opponent TOV\%}$ |
| **3. Rebounding (ORB%)** | **20%** | $\frac{\text{OREB}}{\text{OREB} + \text{Opp DREB}}$ | $\text{DRB\%} = \frac{\text{DREB}}{\text{DREB} + \text{Opp OREB}}$ |
| **4. Free Throw Rate (FTR)** | **15%** | $\frac{\text{FTA}}{\text{FGA}}$ | $100\% - \frac{\text{Opp FTA}}{\text{Opp FGA}}$ |

---

## 2. Four Factors Sepanjang Seluruh Kompetisi (Akumulasi 4 Laga)

### A. Offensive Four Factors (Efektivitas Serangan)

| Peringkat | Tim Putra | GP | Rekor | 1. eFG% *(Shooting)* | 2. TOV% *(Turnover)* | 3. ORB% *(Off. Rebound)* | 4. FT Rate *(FTA/FGA)* | FTM / FGA |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 🥇 | **SMA BOPKRI 1 YOGYAKARTA** | 4 | 4–0 | **53.62%** | **15.30%** | **53.85%** | **18.84%** | 10.14% |
| 🥈 | **SMA OLIFANT** | 4 | 4–0 | **42.51%** | **13.73%** | **58.14%** | **31.36%** | 14.29% |
| 🥉 | **SMA BUDI UTAMA** | 4 | 3–1 | **38.20%** | **16.43%** | **43.14%** | **22.40%** | 11.20% |
| 4 | **SMA NEGERI 4 YOGYAKARTA** | 4 | 3–1 | **36.41%** | **24.14%** | **47.73%** | **29.49%** | 14.75% |

### B. Defensive Four Factors (Efektivitas Pertahanan)

| Peringkat | Tim Putra | 1. Opp eFG% *(Shooting Lawan)* | 2. Opp TOV% *(Turnover Lawan)* | 3. DRB% *(Def. Rebound)* | 4. Opp FT Rate *(FT Lawan)* |
| :---: | :--- | :---: | :---: | :---: | :---: |
| 🥇 | **SMA OLIFANT** | **20.39%** | **44.62%** | **75.93%** | **26.96%** |
| 🥈 | **SMA BOPKRI 1 YOGYAKARTA** | **23.98%** | **39.75%** | **81.89%** | **20.48%** |
| 🥉 | **SMA NEGERI 4 YOGYAKARTA** | **19.75%** | **37.72%** | **61.02%** | **45.23%** |
| 4 | **SMA BUDI UTAMA** | **29.55%** | **42.60%** | **61.90%** | **29.24%** |

---

## 3. Skor Pembobotan & Potensi Menang (Weighted Rating)

### A. Nilai Komposit Terpisah (Skala 0 – 100)

$$\text{Overall Rating} = \frac{\text{Offensive Score} + \text{Defensive Score}}{2}$$

| Peringkat | Tim Putra | Skor Ofensif (Serangan) | Skor Defensif (Pertahanan) | **Overall Rating** |
| :---: | :--- | :---: | :---: | :---: |
| 🥇 **#1** | **SMA BOPKRI 1 YOGYAKARTA** | **56.22** *(Rank 1)* | **68.66** *(Rank 2)* | **62.44** |
| 🥈 **#2** | **SMA OLIFANT** | **54.90** *(Rank 2)* | **69.14** *(Rank 1)* | **62.02** |
| 🥉 **#3** | **SMA BUDI UTAMA** | **48.16** *(Rank 3)* | **61.83** *(Rank 4)* | **54.99** |
| **#4** | **SMA NEGERI 4 YOGYAKARTA** | **47.50** *(Rank 4)* | **61.95** *(Rank 3)* | **54.72** |

### B. Net Margin Rating (Keunggulan Bersih vs Lawan)

$$\text{Net Score} = 0.40(\Delta\text{Shooting}) + 0.25(\Delta\text{Turnover}) + 0.20(\Delta\text{Rebound}) + 0.15(\Delta\text{FT Rate})$$

| Rank | Tim Putra | Net Score | Margin Shooting (40%) | Margin Turnover (25%) | Margin Rebound (20%) | Margin FT Rate (15%) |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: |
| 🥇 **#1** | **SMA BOPKRI 1** | **+24.87** | **+29.65%** *(+11.86)* | **+24.45%** *(+6.11)* | **+35.74%** *(+7.15)* | **-1.63%** *(-0.24)* |
| 🥈 **#2** | **SMA OLIFANT** | **+24.04** | **+22.11%** *(+8.85)* | **+30.88%** *(+7.72)* | **+34.07%** *(+6.81)* | **+4.39%** *(+0.66)* |
| 🥉 **#3** | **SMA BUDI UTAMA** | **+9.99** | **+8.65%** *(+3.46)* | **+26.17%** *(+6.54)* | **+5.04%** *(+1.01)* | **-6.82%** *(-1.02)* |
| **#4** | **SMA NEGERI 4** | **+9.45** | **+16.66%** *(+6.66)* | **+13.58%** *(+3.40)* | **+8.74%** *(+1.75)* | **-15.73%** *(-2.36)* |

*Keterangan: Tanda `+` menunjukkan tim lebih unggul dari lawan-lawannya. Angka di dalam kurung adalah kontribusi poin setelah dikali bobot faktor.*

---

## 4. Khusus Pas Laga Semifinal (Single Game Breakdown)

### Semifinal 1: SMA OLIFANT (49) vs SMA NEGERI 4 YOGYAKARTA (38)
*Game ID: `2934790` | 7 Okt 2026*

| Four Factors | SMA OLIFANT | SMA NEGERI 4 YOGYAKARTA |
| :--- | :---: | :---: |
| **1. Shooting (eFG%)** | **19.05%** *(16/84 FG, 0/25 3PT)* | **22.73%** *(12/55 FG, 1/10 3PT)* |
| **2. Turnover Rate (TOV%)** | **18.25%** *(22 TOV)* | **36.85%** *(38 TOV)* |
| **3. Offensive Rebound (ORB%)** | **47.06%** *(32 OREB vs 36 DREB)* | **35.14%** *(13 OREB vs 24 DREB)* |
| **4. Free Throw Rate (FTA/FGA)** | **39.29%** *(33 FTA / 84 FGA)* | **41.82%** *(23 FTA / 55 FGA)* |
| *Skor Ofensif Semifinal* | **43.36** | **38.18** |
| *Skor Defensif Semifinal* | **61.82** | **56.64** |
| **Overall Rating Semifinal** | **52.59** *(Net: +5.18)* | **47.41** *(Net: -5.18)* |

*Catatan Laga*: Olifant mengalami *shooting slump* berat (0/25 dari 3-point), namun tetap menang berkat 32 Offensive Rebound dan memaksa 38 turnover dari SMAN 4.

---

### Semifinal 2: SMA BOPKRI 1 YOGYAKARTA (68) vs SMA BUDI UTAMA (43)
*Game ID: `2934794` | 7 Okt 2026*

| Four Factors | SMA BOPKRI 1 YOGYAKARTA | SMA BUDI UTAMA |
| :--- | :---: | :---: |
| **1. Shooting (eFG%)** | **40.00%** *(25/70 FG, 6/30 3PT)* | **25.38%** *(15/65 FG, 3/25 3PT)* |
| **2. Turnover Rate (TOV%)** | **22.76%** *(24 TOV)* | **22.26%** *(21 TOV)* |
| **3. Offensive Rebound (ORB%)** | **48.84%** *(21 OREB vs 22 DREB)* | **17.39%** *(8 OREB vs 38 DREB)* |
| **4. Free Throw Rate (FTA/FGA)** | **37.14%** *(26 FTA / 70 FGA)* | **29.23%** *(19 FTA / 65 FGA)* |
| *Skor Ofensif Semifinal* | **50.65** | **37.45** |
| *Skor Defensif Semifinal* | **62.55** | **49.35** |
| **Overall Rating Semifinal** | **56.60** *(Net: +13.20)* | **43.40** *(Net: -13.20)* |

*Catatan Laga*: Bosa mendominasi total di dua sektor berbobot paling tinggi (Shooting +14.62% dan Rebounding +31.45%), menghasilkan kemenangan telak selisih +25 poin.

---

## 5. Rincian Statistik Akumulasi (Raw Box Score)

1. **SMA BOPKRI 1 YOGYAKARTA** (4 Laga, Total Poin: 324 | 81.0 PPG)
   * *Hasil Laga*: 80–9 vs SMAN 7 | 95–9 vs SMAN 1 Kalasan | 81–38 vs SMA Muh 1 | 68–43 vs SMA Budi Utama
   * *Statistik*: FG 135/276 (48.9%), 3PT 26/98 (26.5%), FT 28/52 (53.8%), OREB 70, DREB 104, TOV 54
2. **SMA OLIFANT** (4 Laga, Total Poin: 285 | 71.3 PPG)
   * *Hasil Laga*: 80–12 vs SMAN 2 Yk | 111–7 vs SMAN 1 Bantul | 45–25 vs De Britto | 49–38 vs SMAN 4 Yk
   * *Statistik*: FG 116/287 (40.4%), 3PT 12/55 (21.8%), FT 41/90 (45.6%), OREB 100, DREB 82, TOV 52
3. **SMA BUDI UTAMA** (4 Laga, Total Poin: 219 | 54.8 PPG)
   * *Hasil Laga*: 65–13 vs Stece 2 | 34–19 vs SMAN 3 Yk | 77–9 vs Budi Mulia Dua | 43–68 vs Bosa
   * *Statistik*: FG 89/250 (35.6%), 3PT 13/76 (17.1%), FT 28/56 (50.0%), OREB 66, DREB 65, TOV 54
4. **SMA NEGERI 4 YOGYAKARTA** (4 Laga, Total Poin: 190 | 47.5 PPG)
   * *Hasil Laga*: 64–12 vs SMAN 1 Banguntapan | 32–23 vs SMAN 6 Yk | 56–18 vs PL | 38–49 vs Olifant
   * *Statistik*: FG 75/217 (34.6%), 3PT 8/48 (16.7%), FT 32/64 (50.0%), OREB 63, DREB 72, TOV 78
