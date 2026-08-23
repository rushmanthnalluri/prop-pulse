"""Build PropPulse_Review1.pptx — Project Review 1 deck.

Clean design: no speaker labels on slides (the 3-way speaker plan with
timings lives in the presenter notes), plain-English phrasing, no decorative
dashes/arrows/underscores.

Run from the repo root:
    .venv/Scripts/python.exe review/review1/build_pptx.py
Saves to the first writable PropPulse_Review1*.pptx name (a file left open
in PowerPoint is locked, so the next free variant is used instead).
"""

import os
from pathlib import Path

from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

REPO_ROOT = Path(__file__).resolve().parents[2]
FIG = REPO_ROOT / "figures"
OUT_DIR = Path(__file__).resolve().parent

# ----------------------------------------------------------------- details
TEAM = [
    ("Rushmanth Nalluri", "2500030215"),
    ("Sk Mastan Saheb", "2500030370"),
    ("Rayala Deepak", "2500030717"),
]
GUIDE = "Guide Name, Designation"          # <- edit
DEPARTMENT = "Department of Computer Science & Engineering"   # <- edit
REVIEW_DATE = "August 2026"
REPO_URL = "github.com/rushmanthnalluri/prop-pulse"

# Speaker plan (notes only, never printed on slides):
#   Rushmanth : slides 2, 3, 4 and the closing 12   (~100 s)
#   Mastan    : slides 5, 6, 7 (EDA part 1)         (~100 s)
#   Deepak    : slides 8, 9, 10, 11 (EDA part 2 + repo) (~100 s)

# ------------------------------------------------------------------- palette
NAVY = RGBColor(0x1F, 0x38, 0x64)
GOLD = RGBColor(0xC9, 0xA2, 0x27)
INK = RGBColor(0x21, 0x21, 0x21)
GRAY = RGBColor(0x66, 0x66, 0x66)
FAINT = RGBColor(0xD8, 0xD8, 0xD8)
PANEL = RGBColor(0xF4, 0xF6, 0xFA)
GREEN = RGBColor(0x2E, 0x7D, 0x32)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
SOFT = RGBColor(0xC9, 0xD6, 0xEC)

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
BLANK = prs.slide_layouts[6]

MX = Inches(0.75)          # side margin
CW = Inches(11.83)         # content width


def rect(slide, x, y, w, h, fill):
    sh = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, h)
    sh.fill.solid()
    sh.fill.fore_color.rgb = fill
    sh.line.fill.background()
    sh.shadow.inherit = False
    return sh


def text(slide, x, y, w, h, paras, size=18, color=INK, bold=False,
         align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, spacing=1.0, after=6):
    box = slide.shapes.add_textbox(x, y, w, h)
    tf = box.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    if isinstance(paras, str):
        paras = [paras]
    for i, para in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = spacing
        p.space_after = Pt(after)
        if isinstance(para, str):
            para = [(para, {})]
        for t, ov in para:
            r = p.add_run()
            r.text = t
            r.font.size = Pt(ov.get("size", size))
            r.font.bold = ov.get("bold", bold)
            r.font.italic = ov.get("italic", False)
            r.font.color.rgb = ov.get("color", color)
            r.font.name = "Calibri"
    return box


def bullets(slide, x, y, w, h, items, size=17, after=10, spacing=1.06):
    """items: list of str or [(txt, ov), ...]; prefix a small gold marker."""
    box = slide.shapes.add_textbox(x, y, w, h)
    tf = box.text_frame
    tf.word_wrap = True
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.line_spacing = spacing
        p.space_after = Pt(after)
        m = p.add_run()
        m.text = "\u25aa  "
        m.font.size = Pt(size)
        m.font.color.rgb = GOLD
        m.font.bold = True
        m.font.name = "Calibri"
        if isinstance(item, str):
            item = [(item, {})]
        for t, ov in item:
            r = p.add_run()
            r.text = t
            r.font.size = Pt(ov.get("size", size))
            r.font.bold = ov.get("bold", False)
            r.font.italic = ov.get("italic", False)
            r.font.color.rgb = ov.get("color", INK)
            r.font.name = "Calibri"
    return box


def header(slide, title, page):
    text(slide, MX, Inches(0.42), CW, Inches(0.62), title, size=30,
         color=NAVY, bold=True)
    rect(slide, MX, Inches(1.18), Inches(0.85), Pt(3.2), GOLD)
    rect(slide, MX, Inches(7.02), CW, Pt(0.9), FAINT)
    text(slide, MX, Inches(7.12), Inches(8), Inches(0.3),
         "PropPulse  |  Project Review 1", size=9.5, color=GRAY)
    text(slide, Inches(12.0), Inches(7.12), Inches(0.58), Inches(0.3),
         str(page), size=9.5, color=GRAY, align=PP_ALIGN.RIGHT)


def image_fit(slide, path, x, y, max_w, max_h):
    with Image.open(path) as im:
        iw, ih = im.size
    scale = min(max_w / iw, max_h / ih)
    w, h = int(iw * scale), int(ih * scale)
    return slide.shapes.add_picture(
        str(path), x + int((max_w - w) / 2), y + int((max_h - h) / 2),
        width=w, height=h)


def stat(slide, x, y, w, big, label, big_size=30):
    text(slide, x, y, w, Inches(0.55), big, size=big_size, color=NAVY,
         bold=True)
    text(slide, x, y + Inches(0.58), w, Inches(0.6), label, size=12.5,
         color=GRAY, spacing=1.0, after=2)


def notes(slide, txt):
    slide.notes_slide.notes_text_frame.text = txt


# ================================================================ 1 TITLE
s = prs.slides.add_slide(BLANK)
rect(s, 0, 0, prs.slide_width, prs.slide_height, NAVY)
rect(s, Inches(0.95), Inches(1.5), Inches(0.95), Pt(3.5), GOLD)
text(s, Inches(0.95), Inches(1.78), Inches(11), Inches(0.4),
     "PROJECT REVIEW 1   |   " + REVIEW_DATE.upper(), size=13,
     color=SOFT, bold=True)
text(s, Inches(0.9), Inches(2.18), Inches(11.5), Inches(1.2), "PropPulse",
     size=66, color=WHITE, bold=True)
text(s, Inches(0.95), Inches(3.32), Inches(11.5), Inches(0.5),
     "An end-to-end machine learning platform for residential property "
     "valuation in Ames, Iowa",
     size=19, color=SOFT)
team = [[(f"{n}", {"bold": True, "color": WHITE, "size": 17}),
         (f"    {r}", {"color": SOFT, "size": 14})] for n, r in TEAM]
text(s, Inches(0.95), Inches(4.28), Inches(8), Inches(1.6), team, after=8)
text(s, Inches(0.95), Inches(6.28), Inches(11.5), Inches(0.85), [
    [("Under the guidance of ", {"color": SOFT, "size": 13}),
     (GUIDE, {"bold": True, "color": WHITE, "size": 13})],
    [(DEPARTMENT, {"color": SOFT, "size": 12})],
], after=3)
text(s, Inches(9.0), Inches(6.35), Inches(3.4), Inches(0.5),
     REPO_URL, size=12.5, color=SOFT, align=PP_ALIGN.RIGHT)
notes(s, "OPENING (15 s, Rushmanth): We are team PropPulse: Rushmanth, "
         "Mastan and Deepak. Our project predicts a home's sale price, its "
         "probability of selling within 30 days, and its micro-market "
         "segment for residential real estate in Ames, Iowa, and explains "
         "every estimate. Speaker plan: Rushmanth takes slides 2 to 4 plus "
         "the closing, Mastan takes slides 5 to 7 (EDA part 1), Deepak "
         "takes slides 8 to 11 (EDA part 2 and the repository). Total "
         "about 5 minutes. Fill in the guide name before presenting.")

# ====================================================== 2 PROBLEM STATEMENT
s = prs.slides.add_slide(BLANK)
header(s, "Problem Statement", 2)
text(s, MX, Inches(1.55), CW, Inches(0.9),
     [[("Residential property pricing is opaque. Buyers, sellers and agents "
        "get a number, but rarely an explanation of ", {}),
       ("why", {"italic": True}), (" it is that number.", {})]],
     size=20, color=INK, spacing=1.1)
qs = [("How much is it worth?", "Sale price in dollars, with an 80% "
       "prediction interval (regression on log price)."),
      ("How fast will it sell?", "Calibrated probability of selling within "
       "30 days (classification)."),
      ("Which market is it in?", "Micro-market segment from 25 Ames "
       "neighborhoods (DBSCAN clustering).")]
bw, gap = Inches(3.74), Inches(0.3)
for i, (q, a) in enumerate(qs):
    x = MX + i * (bw + gap)
    rect(s, x, Inches(2.75), bw, Inches(2.5), PANEL)
    rect(s, x, Inches(2.75), bw, Pt(2.6), GOLD)
    text(s, x + Inches(0.25), Inches(3.0), bw - Inches(0.5), Inches(0.75),
         q, size=18, color=NAVY, bold=True)
    text(s, x + Inches(0.25), Inches(3.75), bw - Inches(0.5), Inches(1.4),
         a, size=14.5, color=INK, spacing=1.12)
text(s, MX, Inches(5.75), CW, Inches(0.9),
     [[("The bar we set: ", {"bold": True, "color": NAVY}),
       ("every estimate explained with SHAP factors and served as a real "
        "product (FastAPI backend and React dashboard), not just a "
        "notebook.", {})]], size=17, spacing=1.1)
notes(s, "Rushmanth (about 35 s): Property pricing is opaque. We answer "
         "three questions per home: how much, how fast, and which "
         "micro-market. The bar we set ourselves is that every number comes "
         "with an explanation and ships inside a working product.")

# ============================================================= 3 ABSTRACT
s = prs.slides.add_slide(BLANK)
header(s, "Abstract", 3)
text(s, MX, Inches(1.7), Inches(11.4), Inches(4.9), [
    [("PropPulse is an end-to-end machine learning platform for residential "
      "property valuation in Ames, Iowa (Kaggle House Prices dataset, 1,460 "
      "sales from 2006 to 2010). It predicts a home's sale price in "
      "dollars, the probability that it sells within 30 days, and its "
      "micro-market segment. Every prediction is explained with SHAP "
      "factors.", {"size": 18})],
    [("The methodology is leakage-safe by construction: a time-based split "
      "(train up to 2008, validation 2009, sealed test 2010), all "
      "statistics fit on train only, and one feature pipeline shared by "
      "training and serving. Models are served by a FastAPI backend and a "
      "React dashboard, tracked with MLflow, monitored for drift with PSI, "
      "and packaged with Docker.", {"size": 18})],
    [("This review covers the problem statement, the completed exploratory "
      "data analysis (14 figures from a reproducible notebook), and the "
      "project repository.", {"size": 15, "italic": True, "color": GRAY})],
], spacing=1.18, after=16)
notes(s, "Rushmanth (about 30 s): Summarize, don't read. Three predictions "
         "per property, an honest leakage-safe methodology with a sealed "
         "test set, and a full product stack. Then move to the dataset "
         "slide.")

# ================================================== 4 OBJECTIVES & DATASET
s = prs.slides.add_slide(BLANK)
header(s, "Objectives & Dataset", 4)
text(s, MX, Inches(1.5), Inches(5.6), Inches(0.45), "Six objectives",
     size=17, color=NAVY, bold=True)
objs = [("O1", "Data pipeline: clean, validate, time-based split", True),
        ("O2", "EDA: 14 figures, reproducible (this review)", True),
        ("O3", "94-feature pipeline shared by training and serving", False),
        ("O4", "5 regression and 4 classification candidates", False),
        ("O5", "SHAP explainability, global and per-prediction", False),
        ("O6", "FastAPI, React, drift monitoring, Docker", False)]
items = []
for tag, label, done in objs:
    suffix = ("   (done)", {"color": GREEN, "bold": True,
                            "size": 13}) if done else ("", {})
    items.append([(f"{tag}   ", {"bold": True, "color": NAVY}),
                  (label, {}), suffix])
bullets(s, MX, Inches(2.0), Inches(5.6), Inches(4.6), items, size=15.5,
        after=9)
text(s, MX, Inches(6.35), Inches(5.6), Inches(0.4),
     "O1 and O2 are complete and in the repository today", size=12,
     color=GREEN)
rect(s, Inches(6.85), Inches(1.5), Pt(1), Inches(5.0), FAINT)
text(s, Inches(7.3), Inches(1.5), Inches(5.3), Inches(0.45),
     "Dataset: Ames, Iowa housing (Kaggle, De Cock 2011)", size=17,
     color=NAVY, bold=True)
bullets(s, Inches(7.3), Inches(2.05), Inches(5.3), Inches(3.3), [
    [("1,460 rows, 81 columns", {"bold": True}),
     (" of residential sales, 2006 to 2010", {})],
    [("Time-based split: ", {"bold": True}),
     ("train up to 2008 (945 rows), validation 2009 (338), test 2010 "
      "(175, sealed)", {})],
    [("Cleaning: ", {"bold": True}),
     ("structural gaps filled as \u201cNone\u201d, only LotFrontage "
      "genuinely imputed, 2 partial-sale outliers removed", {})],
    [("Honest fallbacks: ", {"bold": True}),
     ("approximate neighborhood centroids for coordinates (ADR-2), "
      "simulated days on market, always labelled (ADR-3)", {})],
], size=15, after=9)
stat(s, Inches(7.3), Inches(5.55), Inches(1.9), "$165k",
     "median price\n(train, 945 rows)", big_size=26)
stat(s, Inches(9.3), Inches(5.55), Inches(1.9), "3.18\u00d7",
     "price spread across\n25 neighborhoods", big_size=26)
stat(s, Inches(11.3), Inches(5.55), Inches(1.6), "25.3%",
     "fast-sale rate\n(simulated target)", big_size=26)
notes(s, "Rushmanth (about 35 s): Six objectives. O1 and O2 are done and "
         "are today's subject. The dataset is the standard Ames benchmark. "
         "Emphasize the time-based split and the sealed 2010 test set, and "
         "be upfront about the two documented data fallbacks. Hand over to "
         "Mastan for the EDA.")

# ==================================================== 5 EDA TARGET (Mastan)
s = prs.slides.add_slide(BLANK)
header(s, "EDA: The Target Is Right-Skewed", 5)
image_fit(s, FIG / "01_saleprice_distribution.png", Inches(0.55),
          Inches(1.45), Inches(7.5), Inches(5.4))
bullets(s, Inches(8.45), Inches(1.75), Inches(4.35), Inches(3.4), [
    [("Skewness drops from ", {}), ("1.967 to 0.175", {"bold": True,
                                                       "color": NAVY}),
     (" after a log transform, nearly symmetric", {})],
    [("Mean sits about 10% above the median, pulled up by a premium tail "
      "reaching $755k", {})],
    [("Errors scale with price, so a multiplicative model fits better", {})],
    [("Price per sq ft is tight (skew 0.43): most of the skew is a ", {}),
     ("size effect", {"bold": True}), (", not a price-level effect", {})],
], size=15.5, after=12)
text(s, Inches(8.45), Inches(5.35), Inches(4.35), Inches(1.3),
     [[("Decision (ADR-10): ", {"bold": True, "color": NAVY}),
       ("train on log price, use RMSLE as the primary metric, and report "
        "results back in dollars.", {})]], size=15.5, spacing=1.12)
notes(s, "Mastan (about 35 s): The first finding is about the target "
         "itself. Raw prices are heavily right-skewed and nearly symmetric "
         "after a log transform, so we train on log price and use RMSLE. "
         "Price per square foot being tight tells us most of the skew is "
         "just house size.")

# ==================================================== 6 EDA DRIVERS
s = prs.slides.add_slide(BLANK)
header(s, "EDA: What Drives Price", 6)
image_fit(s, FIG / "11_correlation_heatmap.png", Inches(0.55),
          Inches(1.45), Inches(6.8), Inches(5.4))
stat(s, Inches(7.9), Inches(1.7), Inches(1.75), "0.79",
     "OverallQual,\nstrongest correlate", big_size=26)
stat(s, Inches(9.85), Inches(1.7), Inches(1.75), "0.75",
     "GrLivArea,\nstrongest size feature", big_size=26)
stat(s, Inches(11.8), Inches(1.7), Inches(1.4), "0.61",
     "amenity count\n(engineered)", big_size=26)
bullets(s, Inches(7.9), Inches(3.35), Inches(4.9), Inches(3.4), [
    [("Quality ladder is exponential: median price climbs from ", {}),
     ("$109k at grade 4 to $466k at grade 10", {"bold": True})],
    [("Size block follows: TotalBsmtSF 0.64, total bathrooms 0.64, "
      "GarageCars 0.63", {})],
    [("Age correlates at -0.49 but is non-monotone; old character homes "
      "command premiums", {})],
    [("Heavy multicollinearity ", {"bold": True}),
     ("(GarageCars and GarageArea correlate at 0.89), so tree models or "
      "regularized linear, and read importance in groups", {})],
], size=15, after=10)
notes(s, "Mastan (about 35 s): OverallQual dominates with a correlation of "
         "0.79, and the quality ladder is roughly exponential in dollars, "
         "which again supports the log target. Then the size block. Our "
         "engineered amenity count already reaches 0.61. Flag the "
         "multicollinearity: it is why we keep trees plus a regularized "
         "linear baseline.")

# ==================================================== 7 EDA LOCATION
s = prs.slides.add_slide(BLANK)
header(s, "EDA: Location Value Lives in Neighborhoods", 7)
image_fit(s, FIG / "09_neighborhood_prices.png", Inches(0.55),
          Inches(1.45), Inches(6.8), Inches(5.4))
image_fit(s, FIG / "08_geo_scatter.png", Inches(7.6), Inches(1.45),
          Inches(5.2), Inches(3.45))
bullets(s, Inches(7.75), Inches(5.1), Inches(5.0), Inches(1.8), [
    [("Median prices span ", {}), ("3.18\u00d7", {"bold": True,
                                                  "color": NAVY}),
     (", from BrDale at $100k to NridgHt at $318k", {})],
    [("Premium areas sit in the north and northwest; distance to downtown "
      "correlates at only +0.28", {})],
    [("So location value is ", {}),
     ("neighborhood identity, not radial distance", {"bold": True}),
     (", which justifies neighborhood statistics and DBSCAN "
      "micro-markets", {})],
], size=14.5, after=8)
notes(s, "Mastan (about 30 s): The 25 neighborhoods span a 3.18 times "
         "median price spread. The map shows premium areas in the north "
         "and northwest while distance to downtown explains almost "
         "nothing. Location value is neighborhood identity, and that "
         "justifies both the neighborhood statistics and the DBSCAN "
         "clustering. Hand over to Deepak.")

# ================================================ 8 EDA DATA QUALITY
s = prs.slides.add_slide(BLANK)
header(s, "EDA: Data Quality, Missingness & Outliers", 8)
image_fit(s, FIG / "12_missingness_raw.png", Inches(0.55), Inches(1.45),
          Inches(6.4), Inches(5.4))
image_fit(s, FIG / "13_outliers.png", Inches(7.25), Inches(1.45),
          Inches(5.55), Inches(3.5))
bullets(s, Inches(7.4), Inches(5.15), Inches(5.4), Inches(1.8), [
    [("19 raw columns have gaps, nearly all ", {}),
     ("structural", {"bold": True}),
     (" (PoolQC 99.5%), filled as \u201cNone\u201d rather than imputed", {})],
    [("Only LotFrontage (17.7%) is genuinely imputed, with train-fit "
      "neighborhood medians", {})],
    [("Exactly 2 outliers removed", {"bold": True}),
     (" (verified partial sales); the 39 luxury rows above the outlier "
      "fence are real signal, so kept", {})],
], size=14.5, after=8)
notes(s, "Deepak (about 30 s): The missingness looks scary but is almost "
         "entirely structural: the feature is absent, so we fill it as "
         "None per the official data description. Only LotFrontage is "
         "genuinely imputed. For outliers, exactly two verified partial "
         "sales were removed, and the luxury tail stays because it is "
         "exactly the signal a valuation model needs.")

# ================================== 9 EDA SEASONALITY & SIMULATED TARGET
s = prs.slides.add_slide(BLANK)
header(s, "EDA: Seasonality & the Sale-Speed Target", 9)
image_fit(s, FIG / "14_seasonality.png", Inches(0.55), Inches(1.45),
          Inches(6.4), Inches(5.4))
image_fit(s, FIG / "10_days_on_market.png", Inches(7.25), Inches(1.45),
          Inches(5.55), Inches(3.5))
bullets(s, Inches(7.4), Inches(5.15), Inches(5.4), Inches(1.8), [
    [("Volume is seasonal (July 167 sales vs February 27) but the ", {}),
     ("price level barely moves", {"bold": True})],
    [("Median price moved only +0.6% from 2006 to 2008; no shock at the "
      "split boundary", {})],
    [("Simulated days on market:", {"bold": True}),
     (" median 41 days, 25.3% fast sales, so imbalance-aware modeling "
      "with PR-AUC as the primary metric", {})],
], size=14.5, after=8)
notes(s, "Deepak (about 30 s): Seasonality is a volume effect, not a "
         "price effect, and prices are flat across 2006 to 2008, so our "
         "time-based split faces no distribution shock. On the right is "
         "the simulated days-on-market target: median 41 days, one in "
         "four sales fast. Every classification metric will carry the "
         "simulated label.")

# ============================================ 10 FROM EDA TO MODELING
s = prs.slides.add_slide(BLANK)
header(s, "What the EDA Tells Us to Build", 10)
rows = [
    ("1", "Log target is mandatory", "skewness 1.967 down to 0.175, "
     "RMSLE as the primary metric"),
    ("2", "Trees plus a regularized linear baseline", "non-linear size "
     "effects and non-monotone age; the linear model stays as the "
     "interpretable benchmark"),
    ("3", "Expected feature hierarchy", "OverallQual first, then the size "
     "block, neighborhood, and age; importance read in groups"),
    ("4", "Hard leakage guards", "price per sq ft is EDA-only, statistics "
     "fit on train only, SaleType and SaleCondition excluded, days on "
     "market never a feature"),
    ("5", "Imbalance-aware classification", "25.3% fast-sale rate, so "
     "class weights, PR-AUC primary, and a calibration check"),
    ("6", "Neighborhood-grain clustering", "median price per sq ft, sale "
     "velocity, and coordinates feed the DBSCAN micro-markets"),
]
y = Inches(1.6)
for num, head, tail in rows:
    text(s, MX, y, Inches(0.55), Inches(0.5), num, size=20, color=GOLD,
         bold=True)
    text(s, Inches(1.45), y, Inches(11.1), Inches(0.75),
         [[(head + ":  ", {"bold": True, "color": NAVY}),
           (tail, {"color": INK})]], size=16.5, spacing=1.05)
    y += Inches(0.86)
notes(s, "Deepak (about 30 s): Every finding maps to a design decision. "
         "Walk the six quickly: log target, the two model families, the "
         "feature hierarchy, the four leakage rules, imbalance-aware "
         "classification, and the clustering grain. This is the bridge "
         "from analysis to the build plan.")

# ==================================================== 11 REPOSITORY
s = prs.slides.add_slide(BLANK)
header(s, "Repository & Current Status", 11)
text(s, MX, Inches(1.5), CW, Inches(0.45),
     [[(REPO_URL, {"bold": True, "color": NAVY, "size": 19}),
       ("   (branch: main). Everything shown today is committed.",
        {"color": GRAY, "size": 13})]])
bullets(s, MX, Inches(2.25), Inches(6.0), Inches(4.4), [
    [("ml/", {"bold": True}), ("  data, features, training, evaluation, "
      "clustering, explainability, monitoring", {})],
    [("backend/", {"bold": True}), ("  FastAPI service and API tests", {})],
    [("frontend/", {"bold": True}), ("  React dashboard (Vite)", {})],
    [("notebooks/", {"bold": True}), ("  01_eda.ipynb, fully executed, "
      "16 of 16 cells, reproduces all 14 figures", {})],
    [("reports/ and figures/", {"bold": True}), ("  EDA report, audits, "
      "and all figures", {})],
    [("docs/", {"bold": True}), ("  specification, decision records, "
      "architecture, API contract", {})],
], size=15, after=9)
rect(s, Inches(7.15), Inches(2.25), Pt(1), Inches(4.2), FAINT)
stats = [("454", "automated tests passing"), ("49/49", "browser E2E tests"),
         ("CI", "runs on every push, Docker verified"),
         ("100%", "EDA reproducibility: figures regenerate identically")]
y = Inches(2.25)
for big, label in stats:
    stat(s, Inches(7.55), y, Inches(4.6), big, label, big_size=26)
    y += Inches(1.12)
notes(s, "Deepak (about 30 s): The repository is the evidence, so give "
         "the URL. The EDA notebook reruns end to end and reproduces "
         "every figure. The engineering hygiene is real: 454 tests, "
         "browser end-to-end tests, CI, Docker, and every design decision "
         "recorded. Hand back to Rushmanth to close.")

# ================================================= 12 PLAN + CLOSE
s = prs.slides.add_slide(BLANK)
header(s, "Plan Toward Review 2", 12)
cols = [("Done", GREEN, "Problem definition; dataset cleaning and "
         "time-based split; full EDA (this review); repository with "
         "decision records, CI and tests."),
        ("Next", NAVY, "Finalize the 94-feature pipeline. Train 5 "
         "regression and 4 classification candidates with 5-fold cross "
         "validation on train only. Select the champion on validation "
         "with a bootstrap significance test, then evaluate the sealed "
         "test set once."),
        ("Then", NAVY, "SHAP artifacts, FastAPI serving, React dashboard "
         "polish, drift monitoring, Docker packaging. Stretch goal: real "
         "days-on-market data and real geocoding through the ready "
         "adapters.")]
bw, gap = Inches(3.74), Inches(0.3)
for i, (t, c, body) in enumerate(cols):
    x = MX + i * (bw + gap)
    rect(s, x, Inches(1.7), bw, Inches(3.6), PANEL)
    rect(s, x, Inches(1.7), bw, Pt(2.6), c)
    text(s, x + Inches(0.25), Inches(1.95), bw - Inches(0.5), Inches(0.5),
         t, size=18, color=c, bold=True)
    text(s, x + Inches(0.25), Inches(2.55), bw - Inches(0.5), Inches(2.6),
         body, size=14.5, color=INK, spacing=1.15)
text(s, MX, Inches(5.85), CW, Inches(0.8),
     [[("Thank you. Questions welcome.", {"bold": True, "color": NAVY,
                                          "size": 22}),
       ("    " + REPO_URL, {"color": GRAY, "size": 14})]])
notes(s, "Rushmanth (about 25 s): Close with the plan. EDA and the "
         "repository are complete; next is model training and champion "
         "selection, then the serving layer. Thank the panel and invite "
         "questions. Total about 5 minutes across the three of us.")


def save_first_writable():
    names = ["PropPulse_Review1.pptx", "PropPulse_Review1_new.pptx"] + [
        f"PropPulse_Review1_v{i}.pptx" for i in range(3, 10)]
    if os.environ.get("PPTX_OUT"):
        names = [os.environ["PPTX_OUT"]]
    for name in names:
        path = Path(name)
        if not path.is_absolute():
            path = OUT_DIR / name
        try:
            prs.save(path)
            return path
        except PermissionError:
            continue
    raise SystemExit("All output names are locked; close PowerPoint and "
                     "re-run.")


out = save_first_writable()
print(f"Saved {out} ({out.stat().st_size:,} bytes, {len(prs.slides)} slides)")
