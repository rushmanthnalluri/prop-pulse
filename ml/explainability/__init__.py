"""SHAP explainability for the PropPulse regression champion.

- :mod:`ml.explainability.explainer` — core: champion-pipeline introspection,
  transformed-name parsing, one-hot → base-feature SHAP aggregation,
  Linear/Tree explainer auto-selection.
- :mod:`ml.explainability.service` — the backend contract: ``explain_instance``.
- :mod:`ml.explainability.build_artifacts` — CLI building the global artifacts
  (``models/explainability/*`` + ``figures/shap_*.png``).

Imports here stay light on purpose (shap/numba load lazily inside the
explainer), so importing the package never slows down unrelated tooling.
"""
